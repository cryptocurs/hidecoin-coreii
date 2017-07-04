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
const BufferArray = require('./BufferArray')
const db = require('./Db')
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
    this.opened = false
    
    this.data = {}
  }
  
  static getPath(login) {
    return BASE_PATH + 'wallet' + (login === '' ? '' : '-' + login) + '.dat'
  }
  
  static exists(login = '') {
    return fs.existsSync(Wallet.getPath(login))
  }
  
  static use(password, login) {
    const wallet = new Wallet(password, login)
    return wallet
  }
  
  flush(callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      fs.writeFile(this.path, Defended.encrypt(Conv.strToBase(Conv.objToJson(R.map(address => Conv.bufToBase(address.getKeys().priv), this.addresses))), this.password), 'utf8', (err) => {
        if (err) {
          throw err
        }
        unlock()
        callback && callback(true)
      })
    }, allowableLockCount)
  }
  
  create(callback) {
    if (this.opened || Wallet.exists(this.login)) {
      callback && callback(false)
    }
    this.opened = true
    this.flush(() => callback && callback(true))
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
      callback && callback(true)
    })
  }
  
  attachAddress(address, callback) {
    if (!this.opened) {
      callback && callback(null)
      return
    }
    this.addresses.push(address)
    this.flush(() => {
      callback && callback()
    })
  }
  
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
      callback && callback(address)
    })
  }
  
  getAddresses() {
    if (!this.opened) {
      return null
    }
    return this.addresses
  }
  
  getBalances(callback, allowableLockCount = 0) {
    blockchain.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Wallet.getBalances()')
      const balances = {}
      Asyncs.forEach(this.addresses, (address, i, next) => {
        const addressHash = address.getHash()
        db.each("SELECT SUM(amount) amount FROM outs WHERE address=? AND spent_at=?", [addressHash, -1], (res) => {
          balances[addressHash] = res.amount
          next()
        })
      }, () => {
        unlock()
        callback && callback(balances)
      })
    }, allowableLockCount)
  }
  
  getSoftBalances(callback, allowableLockCount = 0) {
    blockchain.whenUnlocked((unlock) => {
      blockchain.getLength((blockchainLength) => {
        this.logBy('LCK', 'Locked by Wallet.getBalances()')
        const balances = {}
        Asyncs.forEach(this.addresses, (address, i, next) => {
          const addressHash = address.getHash()
          db.each("SELECT SUM(amount) amount FROM outs WHERE block_height>? AND address=? AND spent_at=?", [blockchainLength - MIN_CONFIRMATIONS, addressHash, -1], (res) => {
            balances[addressHash] = res.amount
            next()
          })
        }, () => {
          unlock()
          callback && callback(balances)
        })
      }, 1)
    }, allowableLockCount)
  }
  
  getFreeBalances(callback) {
    const balances = {}
    R.forEach((address) => {
      balances[address.getHash()] = 0
    }, this.addresses)
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
  
  /*
    recipients - array of {string address, float amount, int amountm}
    senders - array of string address
  */
  sendCoins(recipients, senders = null, callback) {
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
          
          let finished = false
          Asyncs.forEach(addressesBalances, ({address: senderAddress}, i, next) => {
            const {priv, publ} = addressesData[senderAddress]
            db.each("SELECT * FROM outs WHERE address=? AND spent_at=?", [senderAddress, -1], ({block_height, tx_hash, out_n, amount, spent_at}) => {
              if (finished) {
                return
              }
              const txHash = Conv.hexToBuf(tx_hash)
              if (spent_at === -1 && blockchainLength - block_height >= MIN_CONFIRMATIONS && !blockchain.isTxOutSpentFreeTxs(txHash, out_n)) {
                txIns.push({txHash, outN: out_n, priv, publ})
                rest -= amount
                if (rest <= 0) {
                  finished = true
                }
              }
            }, () => finished ? finishTx() : next())
          }, () => finishTx())
          
          const finishTx = () => {
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
        }
        
        let addressesBalances = []
        const addressesData = {}
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
        
        Asyncs.forEach(this.addresses, (address, i, next) => {
          const addressHash = address.getHash()
          if (!senders || R.contains(addressHash, senders)) {
            db.each("SELECT SUM(amount) amount FROM outs WHERE address=? AND spent_at=?", [addressHash, -1], (res) => {
              addressesBalances.push({address: addressHash, balance: res.amount})
              addressesData[addressHash] = address.getKeys()
              addressesData[addressHash].raw = address.getRaw()
              next()
            })
          } else {
            next()
          }
        }, () => {
          addressesBalances = R.sort((a, b) => b.balance - a.balance, addressesBalances)
          createTx()
        })
      }, 1)
    })
  }
}