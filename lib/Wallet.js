'use strict'

const fs = require('fs')
const R = require('ramda')

const {Asyncs, Conv, Defended, Time} = require('./helpers')
const Component = require('./Component')
const ifc = require('./Interface')
const Address = require('./Address')
const blockchain = require('./Blockchain')
const Block = require('./Block')
const Tx = require('./Tx')
const txProcessor = require('./TxProcessor')
const WCache = require('./WCache')
const BufferArray = require('./BufferArray')
const {MIN_CONFIRMATIONS, MIN_FEE, MIN_FEE_PER_BYTE} = require('./Constants')

const BASE_PATH = __dirname + '/../data/'

module.exports = class Wallet extends Component {

  constructor(password, login = '') {
    super()
    this.module = 'WLT'
    this.login = login
    this.password = password
    this.path = Wallet.getPath(this.login)
    this.addresses = []
    this.wcache = null
    this.opened = false
    
    this.data = {}
  }
  
  static getPath(login) {
    return BASE_PATH + 'wallet' + (login === '' ? '' : '-' + login) + '.dat'
  }
  
  static exists(login) {
    return fs.existsSync(Wallet.getPath(login))
  }
  
  static use(password, login) {
    const wallet = new Wallet(password, login)
    return wallet
  }
  
  flush(callback) {
    fs.writeFile(this.path, Defended.encrypt(Conv.strToBase(Conv.objToJson(R.map(address => Conv.bufToBase(address.getKeys().priv), this.addresses))), this.password), 'utf8', (err) => {
      if (err) {
        throw err
      }
      callback && callback(true)
    })
  }
  
  create(callback) {
    if (this.opened || Wallet.exists(this.login)) {
      callback && callback(false)
    }
    this.opened = true
    this.flush(() => {
      this.updateBalances(callback)
    })
  }
  
  open(callback) {
    fs.readFile(this.path, 'utf8', (err, data) => {
      if (err) {
        throw err
      }
      const decrypted = Defended.decrypt(data, this.password)
      if (!decrypted) {
        callback && callback(false)
        return
      }
      this.addresses = R.map(keyBased => Address.fromPrivateKey(Conv.baseToBuf(keyBased)), Conv.jsonToObj(Conv.baseToStr(decrypted)))
      this.opened = true
      this.updateBalances(callback)
    })
  }
  
  /* must work with WCache
  attachAddress(address) {
    if (!this.opened) {
      return false
    }
    this.addresses.push(address)
    this.flush()
    return true
  }
  */
  
  isOpened() {
    return this.opened
  }
  
  createAddress(callback) {
    if (!this.opened) {
      callback && callback(null)
      return
    }
    const address = Address.create()
    this.addresses.push(address)
    this.flush(() => {
      this.wcache.addAddress(address.getRaw())
      this.wcache.flush(() => {
        this.emit('changed')
        callback && callback(address)
      })
    })
  }
  
  getAddresses() {
    if (!this.opened) {
      return null
    }
    return this.addresses
  }
  
  updateBalances(callback) {
    if (!this.opened) {
      callback && callback(false)
      return
    }
    if (this.wcache) {
      callback && callback(true)
      return
    }
    
    blockchain.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Wallet.updateBalances()')
      WCache.getInstance(this.login, (instance) => {
        if (instance) {
          this.wcache = instance
          unlock()
          callback && callback(true)
        } else {
          blockchain.getLength((blockchainLength) => {
            WCache.create(this.login, (wcache) => {
              this.wcache = wcache
              R.forEach((address) => {
                wcache.addAddress(address.getRaw())
              }, this.addresses)
              ifc.openWindow('loading')
              ifc.updateWindow('loading', {info: 'Caching wallet data (first use of wallet)...'})
              blockchain.each(({id: blockId, hash, data}, next) => {
                if (!(blockId % 1000)) {
                  ifc.updateWindow('loading', {info: 'Caching wallet data (first use of wallet)...' + (blockId * 100 / blockchainLength >> 0) + '%'})
                }
                const block = Block.fromRaw(hash, data)
                const blockUnpacked = block.getData()
                for (const i in blockUnpacked.txList) {
                  const tx = blockUnpacked.txList[i]
                  const txHash = tx.getHash()
                  const txUnpacked = tx.getData()
                  txUnpacked.txOuts.each(({address: addressRaw, value: amount}, outN) => {
                    for (const i in this.addresses) {
                      const address = this.addresses[i]
                      if (addressRaw.equals(address.getRaw())) {
                        if (wcache.isTxOutKnown(txHash, outN)) {
                          continue
                        }
                        const spent = blockchain.isTxOutSpent(txHash, outN, blockchainLength)
                        wcache.addTxOut(addressRaw, blockId, txHash, outN, amount, spent ? spent.blockId : -1)
                      }
                    }
                  })
                }
                next()
              }, () => {
                wcache.flush(() => {
                  wcache.register(() => {
                    unlock()
                    ifc.openWindow('wallet')
                    callback && callback(true)
                  })
                })
              }, true, 1)
            })
          }, 1)
        }
      })
    })
  }
  
  getBalances(callback, allowableLockCount = 0) {
    if (!this.wcache) {
      callback && callback(null)
      return
    }
    
    blockchain.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Wallet.getBalances()')
      unlock()
      const balances = {}
      this.wcache.eachAddress(({address, balance}) => {
        balances[Address.rawToHash(address)] = balance
      })
      callback && callback(balances)
    }, allowableLockCount)
  }
  
  getSoftBalances(callback, allowableLockCount = 0) {
    if (!this.wcache) {
      callback && callback(null)
      return
    }
    
    blockchain.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Wallet.getSoftBalances()')
      blockchain.getLength((blockchainLength) => {
        unlock()
        const balances = {}
        this.wcache.eachAddress(({address}) => {
          let balance = 0
          this.wcache.savePosition(() => {
            this.wcache.rEachTxOutByAddress(address, ({blockId, amount, spentInBlockId}) => {
              if (blockchainLength - blockId >= MIN_CONFIRMATIONS) {
                return true
              }
              if (spentInBlockId === -1) {
                balance += amount
              }
            })
          })
          balances[Address.rawToHash(address)] = balance
        })
        callback && callback(balances)
      }, allowableLockCount + 1)
    }, allowableLockCount)
  }
  
  getFreeBalances(callback) {
    if (!this.wcache) {
      callback && callback(null)
      return
    }
    
    const balances = {}
    this.wcache.eachAddress(({address}) => {
      balances[Address.rawToHash(address)] = 0
    })
    blockchain.eachFreeTx(({hash, data}, i, raw, next) => {
      const tx = Tx.fromRaw(hash, data)
      tx.getData().txOuts.each(({address, value}) => {
        for (const addressHash in balances) {
          if (Address.rawToHash(address) === addressHash) {
            balances[addressHash] += value
          }
        }
      })
      next()
    }, () => {
      callback && callback(balances)
    })
  }
  
  getKeysByAddressHash(addressHash) {
    for (const i in this.addresses) {
      const address = this.addresses[i]
      if (address.getHash() === addressHash) {
        return address.getKeys()
      }
    }
    return null
  }
  
  /*
    recipients - array of {string address, float amount, int amountm}
    senders - array of string address
  */
  sendCoins(recipients, senders = null, callback) {
    const {wcache} = this
    
    if (!wcache) {
      callback && callback(false, 'No wcache')
      return
    }
    
    blockchain.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Wallet.sendCoins()')
      blockchain.getLength((blockchainLength) => {
        const createTx = () => {
          this.log('Creating tx', {toSend, toReceive})
          let rest = toSend
          const tx = Tx.create()
          tx.setTime(Time.global())
          R.forEach(({address, amount, amountm}) => {
            tx.addOut(Address.hashToRaw(address), amount * 100000000 + amountm)
          }, recipients)
          txIns.clear()
          for (const i in addressesBalances) {
            const {address: senderAddress} = addressesBalances[i]
            const {priv, publ, raw} = addressesData[senderAddress]
            if (wcache.eachTxOutByAddress(raw, ({outCount, blockId, txHash, outN, amount, spentInBlockId}) => {
              if (spentInBlockId === -1 && blockchainLength - blockId >= MIN_CONFIRMATIONS && !blockchain.isTxOutSpentFreeTxs(txHash, outN)) {
                txIns.push({txHash, outN, priv, publ})
                rest -= amount
                if (rest <= 0) {
                  return true
                }
              }
            })) {
              break
            }
          }
          if (rest > 0) {
            unlock()
            callback && callback(false, 'Not enough micoins')
            return
          }
          if (rest < 0) {
            tx.addOut(addressesData[addressesBalances[0].address].raw, -rest)
          }
          txIns.eachAsync(({txHash, outN, priv, publ}, i, raw, next) => {
            tx.addIn(txHash, outN, {priv, publ}, next)
          }, () => {
            const feeMustBe = Tx.calcFee(tx.getRawDataLength())
            const feeReal = toSend - toReceive
            if (feeReal < feeMustBe) {
              this.log({feeReal, feeMustBe})
              toSend = toReceive + feeMustBe
              setImmediate(createTx)
            } else {
              unlock()
              txProcessor.add(tx.getHash(), tx.getRawData(), 'WLT', (valid, err, fee) => {
                callback && callback(valid, err, fee)
              })
            }
          })
        }
        
        let addressesBalances = []
        let addressesData = {}
        const txIns = BufferArray({
          step: 133,
          fields: {
            txHash: {type: 'buffer', size: 32},
            outN: {type: 'number', size: 4},
            priv: {type: 'buffer', size: 32},
            publ: {type: 'buffer', size: 65}
          }
        })
        R.forEach((rec) => {
          rec.amount = rec.amount || 0
          rec.amountm = rec.amountm || 0
        }, recipients)
        const addresses = R.map((rec) => rec.address, recipients)
        const toReceive = R.reduce((acc, {amount, amountm}) => {
          return acc + amount * 100000000 + amountm
        }, 0, recipients)
        let toSend = toReceive + MIN_FEE
        wcache.eachAddress(({address, balance}) => {
          const addressHash = Address.rawToHash(address)
          if (!senders || R.contains(addressHash, senders)) {
            addressesBalances.push({address: addressHash, balance})
            addressesData[addressHash] = this.getKeysByAddressHash(addressHash)
            addressesData[addressHash].raw = address
          }
        })
        addressesBalances = R.sort((a, b) => b.balance - a.balance, addressesBalances)
        
        createTx()
      }, 1)
    })
  }
}