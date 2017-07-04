'use strict'

/* TODO:
*  use lastBlocksHashesIds (to get hash) and lastBlocksIdsData (to get data) in getRaw()
*  deleteOldFreeTxs() need this.emit('changed') ???
*/

const fs = require('fs')

const {Asyncs, Conv, Files, Sorted, Time} = require('./helpers')
const disp = require('./Disp')
const storage = require('./Storage')
const db = require('./Db')
const Component = require('./Component')
const Address = require('./Address')
const BufferArray = require('./BufferArray')
const ScalableBufferArray = require('./ScalableBufferArray')
const SteppedBuffer = require('./SteppedBuffer')
const {BLOCK_HEADER_LENGTH, BLOCK_MINIMAL_LENGTH} = require('./Constants')

const BASE_PATH = __dirname + '/../data/'
const PATH_CHECKPOINTS = BASE_PATH + 'checkpoints/'
const NAME_IND = 'blockchain.ind'
const NAME_DAT = 'blockchain.dat'
const NAME_TIMES = 'times2.cache'
const NAME_COINS = 'coins.cache'
const PATH_IND = BASE_PATH + NAME_IND
const PATH_DAT = BASE_PATH + NAME_DAT
const PATH_TIMES = BASE_PATH + NAME_TIMES
const PATH_COINS = BASE_PATH + NAME_COINS

const INITIAL_PREV_BLOCK = Buffer.from('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 'hex')
const NOT_SPENT = 0xFFFFFFFF

class Blockchain extends Component {

  constructor() {
    super()
    this.module = 'BLK'
    this.indexCached = SteppedBuffer(4096)
    this.length = fs.existsSync(PATH_IND) ? parseInt(fs.statSync(PATH_IND).size / 40) : 0
    this.dataSize = fs.existsSync(PATH_DAT) ? parseInt(fs.statSync(PATH_DAT).size) : 0
    this.cached = false
    
    storage.session.blockchain = {length: this.length}
    if (!storage.plugins) {
      storage.plugins = {}
    }
    /*
    if (!storage.plugins.blockchain) {
      storage.plugins.blockchain = []
    }
    */
    // disable plugins
    storage.plugins.blockchain = []
    this.log('Plugins DISABLED')
    
    this.blockTimes = BufferArray({
      step: 65536,
      fields: {
        id: {type: 'number', size: 4},
        time: {type: 'number', size: 8}
      }
    })
    this.coins = BufferArray({
      step: 65536,
      fields: {
        address: {type: 'buffer', size: 25},
        count: {type: 'number', size: 4}
      }
    })
    
    this.lastBlocksHashesIds = BufferArray({
      step: 36,
      fields: {
        id: {type: 'number', size: 4},
        hash: {type: 'buffer', size: 32}
      }
    })
    this.lastBlocksIdsData = ScalableBufferArray({
      step: 65536,
      fields: {
        id: {type: 'number', size: 4},
        data: {type: 'buffer'}
      }
    })
    
    this.freeTxs = ScalableBufferArray({
      step: 65536,
      fields: {
        hash: {type: 'buffer', size: 32},
        data: {type: 'buffer'},
        added: {type: 'number', size: 8}
      }
    })
    
    this.blockTimesTail = SteppedBuffer(16384)
    
    this.cacheIndex = (fd, callback) => {
      const indexSize = this.length * 40
      const indexCached = Buffer.allocUnsafeSlow(indexSize)
      fs.read(fd, indexCached, 0, indexSize, 0, (err) => {
        if (err) {
          throw err
        }
        this.indexCached.addBuffer(indexCached)
        callback()
      })
    }
    
    this.addToLastBlocksHashesIds = (id, hash) => {
      this.lastBlocksHashesIds.filter((item) => item.id < this.length - 10)
      this.lastBlocksHashesIds.push({id, hash})
    }
    
    this.addToLastBlocksIdsData = (id, data) => {
      this.lastBlocksIdsData.filter((item) => item.id < this.length - 10)
      this.lastBlocksIdsData.push({id, data})
    }
    
    this.removeOutdatedFromLastBlocksHashesIds = () => {
      this.lastBlocksHashesIds.filter((item) => item.id >= this.length)
    }
    
    this.removeOutdatedFromLastBlocksIdsData = () => {
      this.lastBlocksIdsData.filter((item) => item.id >= this.length)
    }
    
    this.writeBlockTimesCache = () => {
      return new Promise((resolve, reject) => {
        this.log('{yellow-fg}Saving times2.cache...{/yellow-fg}')
        fs.writeFile(PATH_TIMES, this.blockTimes.getWhole(), (err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }
    
    this.writeCoinsCache = () => {
      return new Promise((resolve, reject) => {
        this.log('{yellow-fg}Saving coins.cache...{/yellow-fg}')
        fs.writeFile(PATH_COINS, this.coins.getWhole(), (err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }
    
    this.appendBlockTimesCacheIfNeeded = () => {
      return new Promise((resolve, reject) => {
        this.log('{yellow-fg}Appending times2.cache...{/yellow-fg}')
        if (this.blockTimesTail.getLength()) {
          fs.appendFile(PATH_TIMES, this.blockTimesTail.getWhole(), (err) => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          })
        } else {
          this.log('{red-fg}times tail is empty{/red-fg}')
          resolve()
        }
      })
    }
    
    this.eachPlugin = (itemCallback, returnCallback) => {
      Asyncs.forEach(storage.plugins.blockchain, ({className, id}, i, next) => {
        const classDef = require('./' + className)
        classDef.getInstance(id, (instance) => {
          if (instance) {
            itemCallback(instance, next)
          } else {
            next()
          }
        })
      }, returnCallback)
    }
    
    this.lock(3)
    fs.open(PATH_IND, 'a+', (err, fd) => {
      if (err) {
        throw err
      }
      this.cacheIndex(fd, () => {
        fs.close(fd, (err) => {
          if (err) {
            throw err
          }
          this.unlock()
        })
      })
    })
    fs.open(PATH_DAT, 'a+', (err, fd) => {
      if (err) {
        throw err
      }
      fs.close(fd, (err) => {
        if (err) {
          throw err
        }
        this.unlock()
      })
    })
    Files.needDir(PATH_CHECKPOINTS, () => {
      this.unlock()
    })
  }
  
  // startCallback(finished)
  // lock blockchain before call this
  workWithCache(startCallback, endCallback) {
    const next = () => {
      storage.blockchainCached = true
      storage.flush(() => {
        disp.unlockTerm()
        this.emit('changed')
        endCallback && endCallback()
      })
    }
    
    this.blockTimesTail.clear()
    
    disp.lockTerm()
    storage.blockchainCached = false
    storage.flush(() => {
      let isChanged = 0
      startCallback((rewrite = false) => {
        isChanged = rewrite ? 2 : 1
      }, () => {
        if (isChanged === 2) {
          this.writeBlockTimesCache()
          .then(() => this.writeCoinsCache())
          .then(() => {
            this.eachPlugin((instance, next) => {
              instance.onSaveCache(next)
            }, () => {
              next()
            })
          })
        } else if (isChanged === 1) {
          this.appendBlockTimesCacheIfNeeded()
          .then(() => this.writeCoinsCache())
          .then(() => {
            this.eachPlugin((instance, next) => {
              instance.onSaveCache(next)
            }, () => {
              next()
            })
          })
        } else {
          next()
        }
      })
    })
  }
  
  addBlockToDb(blockId, block) {
    return new Promise((resolve, reject) => {
      const blockUnpacked = block.getData()
      Asyncs.forEach(blockUnpacked.txList, (tx, i, nextTx) => {
        const txHash = tx.getHash()
        const txData = tx.getData()
        db.query("INSERT INTO txs (block_height, hash) VALUES (?, ?)", [blockId, Conv.bufToHex(txHash)])
          .then(() => {
            txData.txIns.eachAsync((txIn, i, raw, next) => {
              db.query("UPDATE outs SET spent_at=? WHERE tx_hash=? AND out_n=?", [blockId, Conv.bufToHex(txIn.txHash), txIn.outN]).then(next)
            }, () => {
              txData.txOuts.eachAsync(({address, value}, outN, raw, next) => {
                db.query("INSERT INTO outs (block_height, tx_hash, out_n, address, amount, spent_at) VALUES (?, ?, ?, ?, ?, ?)", [blockId, Conv.bufToHex(txHash), outN, Address.rawToHash(address), value, -1]).then(next)
              }, () => {
                nextTx()
              })
            })
          })
      }, () => {
        resolve()
      })
    })
  }
  
  addBlockToDbQueued(blockId, block) {
    return new Promise((resolve, reject) => {
      const blockUnpacked = block.getData()
      Asyncs.forEach(blockUnpacked.txList, (tx, i, nextTx) => {
        const txHash = tx.getHash()
        const txData = tx.getData()
        db.bigQueryPush("INSERT INTO txs (block_height, hash) VALUES ", [blockId, Conv.bufToHex(txHash)])
          .then(() => db.bigQueryRunAll()).then(() => {
            txData.txIns.each((txIn) => {
              const txHashHex = Conv.bufToHex(txIn.txHash)
              if (!this.spends[txHashHex]) {
                this.spends[txHashHex] = {}
              }
              if (!this.spends[txHashHex][txIn.outN]) {
                this.spends[txHashHex][txIn.outN] = {}
              }
              this.spends[txHashHex][txIn.outN] = blockId
            })
            txData.txOuts.eachAsync(({address, value}, outN, raw, next) => {
              const txHashHex = Conv.bufToHex(txHash)
              const spentAt = this.spends[txHashHex] && this.spends[txHashHex][outN] || -1
              db.bigQueryPush("INSERT INTO outs (block_height, tx_hash, out_n, address, amount, spent_at) VALUES ", [blockId, txHashHex, outN, Address.rawToHash(address), value, spentAt]).then(next)
            }, () => {
              delete this.spends[Conv.bufToHex(txHash)]
              nextTx()
            })
          })
      }, () => {
        resolve()
      })
    })
  }
  
  removeBlocksFromDb(blockchainLength) {
    return new Promise((resolve, reject) => {
      db.query("DELETE FROM txs WHERE block_height>=?", [blockchainLength])
        .then(() => db.query("DELETE FROM outs WHERE block_height>=?", [blockchainLength]))
        .then(() => db.query("UPDATE outs SET spent_at=-1 WHERE spent_at>=?", [blockchainLength]))
        .then(() => resolve())
    })
  }
  
  // call workWithCache before adding blocks
  add(block, callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.add()')
      
      const indexRecord = Buffer.allocUnsafe(40)
      block.getHash().copy(indexRecord)
      indexRecord.writeUIntBE(this.dataSize, 32, 8)
      
      this.indexCached.tail()
      this.indexCached.addBuffer(indexRecord)
      
      disp.lockTerm()
      
      const blockId = this.length
      const blockUnpacked = block.getData()
      this.addTime({id: blockId, time: blockUnpacked.time})
      this.addCoin(this.getMinerAddressFromBlock(block))
      this.addBlockToDb(blockId, block)
        .then(() => {
          this.length++
          storage.session.blockchain.length = this.length
          this.dataSize += block.getRawDataLength()
          
          // blockchain plugins
          this.eachPlugin((instance, next) => {
            instance.onAddedBlock(blockId, block, next, allowableLockCount + 1)
          }, () => {
            fs.appendFile(PATH_IND, indexRecord, (err) => {
              if (err) {
                throw err
              }
              fs.appendFile(PATH_DAT, block.getRawData(), (err) => {
                if (err) {
                  throw err
                }
                disp.unlockTerm()
                unlock()
                callback && callback()
              })
            })
          })
        })
    }, allowableLockCount)
  }
  
  removeLast(count, callback, allowableLockCount = 0) {
    const Block = require('./Block')
    
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.removeLast()')
      
      this.eachFromTo(this.length - count, this.length, ({id, hash, data}, next) => {
        const address = this.getMinerAddressFromBlock(Block.fromRaw(hash, data))
        // this.logBy('COL', 'DEBUG: Removing coin from #' + id + '. Was: ' + this.getMinedBlocksByAddress(address))
        this.subCoin(address)
        // this.logBy('COL', 'DEBUG: Now: ' + this.getMinedBlocksByAddress(address))
        next()
      }, () => {
        this.length -= count
        storage.session.blockchain.length = this.length
        const startIndex = this.length * 40
        this.indexCached.seek(startIndex + 32)
        this.dataSize = this.indexCached.readUInt(8)
        this.indexCached.removeTail(count * 40)
        
        this.removeOutdatedFromLastBlocksHashesIds()
        this.removeOutdatedFromLastBlocksIdsData()
        
        disp.lockTerm()
        
        this.blockTimes.filter(({id}) => id < this.length)
        this.removeBlocksFromDb(this.length)
          .then(() => {
            this.eachPlugin((instance, next) => {
              instance.onRemovedBlocks(this.length, next, allowableLockCount + 1)
            }, () => {
              fs.truncate(PATH_IND, startIndex, (err) => {
                if (err) {
                  throw err
                }
                fs.truncate(PATH_DAT, this.dataSize, (err) => {
                  if (err) {
                    throw err
                  }
                  disp.unlockTerm()
                  unlock()
                  callback && callback()
                })
              })
            })
          })
      }, null, allowableLockCount + 1)
    }, allowableLockCount)
  }
  
  getRaw(id, callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.getRaw()')
      
      if (id < 0 || id >= this.length) {
        unlock()
        callback(null)
        return
      }
      
      const {indexCached} = this
      
      indexCached.seek(id * 40)
      const hash = indexCached.readBuffer(32)
      const start = indexCached.readUInt(8)
      let end
      if (id === this.length - 1) {
        end = this.dataSize
      } else {
        indexCached.forward(32)
        end = indexCached.readUInt(8)
      }
      const size = end - start
      
      fs.open(PATH_DAT, 'r', (err, fd) => {
        if (err) {
          throw err
        }
        const buffer = Buffer.allocUnsafe(size)
        fs.read(fd, buffer, 0, size, start, (err, bytesRead, buffer) => {
          if (err) {
            throw err
          }
          fs.close(fd, (err) => {
            if (err) {
              throw err
            }
            unlock()
            callback({id, hash, data: buffer})
          })
        })
      })
    }, allowableLockCount)
  }
  
  work(callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      fs.open(PATH_DAT, 'r', (err, fd) => {
        if (err) {
          throw err
        }
        this.fd = fd
        callback(() => {
          fs.close(fd, (err) => {
            if (err) {
              throw err
            }
            this.fd = null
            unlock()
          })
        })
      })
    }, allowableLockCount)
  }
  
  workingGetRaw(id, callback) {
    if (id < 0 || id >= this.length) {
      callback(null)
      return
    }
    
    const {indexCached} = this
    
    indexCached.seek(id * 40)
    const hash = indexCached.readBuffer(32)
    const start = indexCached.readUInt(8)
    let end
    if (id === this.length - 1) {
      end = this.dataSize
    } else {
      indexCached.forward(32)
      end = indexCached.readUInt(8)
    }
    const size = end - start
    
    const data = Buffer.allocUnsafe(size)
    fs.read(this.fd, data, 0, size, start, (err) => {
      if (err) {
        throw err
      }
      callback({id, hash, data})
    })
  }
  
  getBlockIdByHash(hash, callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.getBlockIdByHash()')
      
      const item = this.lastBlocksHashesIds.getWith('hash', hash)
      if (item) {
        unlock()
        callback(item.id)
      } else {
        let i = 0
        const next = () => {
          if (this.indexCached.untilEnd()) {
            const blockHash = this.indexCached.readBuffer(32)
            if (blockHash.equals(hash)) {
              this.addToLastBlocksHashesIds(i, hash)
              unlock()
              callback(i)
            } else {
              i++
              this.indexCached.forward(8)
              // to prevent 'maximum call stack size exceeded'
              setImmediate(() => {
                next()
              })
            }
          } else {
            unlock()
            callback(-1)
          }
        }
        
        this.indexCached.seek(0)
        next()
      }
    }, allowableLockCount)
  }
  
  getBlockById(id, callback, allowableLockCount = 0) {
    const Block = require('./Block')
    
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.getBlockById()')
      
      unlock()
      this.getRaw(id, (blockInfo) => {
        if (blockInfo) {
          callback(Block.fromRaw(blockInfo.hash, blockInfo.data))
        } else {
          callback(null)
        }
      }, allowableLockCount)
    }, allowableLockCount)
  }
  
  getBlockByHash(hash, callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.getBlockByHash()')
      
      this.getBlockIdByHash(hash, (id) => {
        if (id === -1) {
          unlock()
          callback(null, -1)
        } else {
          unlock()
          this.getBlockById(id, (block) => {
            callback(block, id)
          }, allowableLockCount)
        }
      }, allowableLockCount + 1)
    }, allowableLockCount)
  }
  
  getLastBlock(callback, allowableLockCount = 0) {
    // to make sure that no other processes change this.length
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.getLastBlock()')
      
      unlock()
      const id = this.length - 1
      this.getBlockById(id, (block) => {
        callback(block, id)
      }, allowableLockCount)
    }, allowableLockCount)
  }
  
  getHash(id, callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.getHash()')
      
      if (id < 0 || id >= this.length) {
        unlock()
        callback(null)
        return
      }
      
      const {indexCached} = this
      
      indexCached.seek(id * 40)
      const hash = indexCached.readBuffer(32)
      unlock()
      callback(hash)
    }, allowableLockCount)
  }
  
  getPrevBlockForNextBlock(callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.getPrevBlockForNextBlock()')
      
      if (this.length) {
        unlock()
        this.getHash(this.length - 1, callback, allowableLockCount)
      } else {
        unlock()
        callback(INITIAL_PREV_BLOCK)
      }
    }, allowableLockCount)
  }
  
  getTx(hash, callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.getTx()')
      
      db.each("SELECT block_height FROM txs WHERE hash=? LIMIT 1", [Conv.bufToHex(hash)], ({block_height: blockId}) => {
        this.getBlockById(blockId, (block) => {
          if (!block) {
            unlock()
            callback(null)
            return
          }
          
          const blockData = block.getData()
          for (const i in blockData.txList) {
            const tx = blockData.txList[i]
            if (tx.getHash().equals(hash)) {
              unlock()
              callback(tx)
              return
            }
          }
        }, allowableLockCount + 1)
      }, (rowCount) => {
        if (!rowCount) {
          unlock()
          callback(null)
          return
        }
      })
    }, allowableLockCount)
  }
  
  getMinerAddressFromBlock(block) {
    return block.getData().txList[0].getData().txOuts.get(0).address
  }
  
  getCountByTime(since, till) {
    let count = 0
    return this.blockTimes.rEach(({id, time}) => {
      if (time >= since && time <= till) {
        count++
      }
      if (id === 0 || time < since) {
        return count
      }
    })
  }
  
  getMinedBlocksByAddress(address) {
    const index = this.coins.indexOf('address', address)
    if (index === -1) {
      return 0
    }
    
    return this.coins.get(index).count
  }
  
  getAddressOut(txHash, outN) {
    const indexes = Sorted.indexesOfBA(this.addressOuts, txHash, Sorted.compareBuffers, 'txHash')
    for (const i in indexes) {
      const index = indexes[i]
      const addressOut = this.addressOuts.get(index)
      if (addressOut.outN === outN) {
        addressOut.index = index
        return addressOut
      }
    }
    return null
  }
  
  // maxBlockId - including
  txOutSpentAt(hash, outN, maxBlockId, callback) {
    db.each("SELECT spent_at FROM outs WHERE tx_hash=? AND out_n=?", [Conv.bufToHex(hash), outN], ({spent_at: blockId}) => {
      callback(blockId > maxBlockId ? -1 : blockId)
    }, (rowCount) => {
      if (rowCount !== 1) {
        throw new Error('Error in database')
      }
    })
  }
  
  isTxOutSpentFreeTxs(hash, out) {
    const Tx = require('./Tx')
    return this.freeTxs.each(({hash: freeTxHash, data}) => {
      const tx = Tx.fromRaw(freeTxHash, data)
      return tx.getData().txIns.each(({txHash, outN}) => {
        if (txHash.equals(hash) && outN === out) {
          return true
        }
      }, false)
    }, false)
  }
  
  deleteOldFreeTxs() {
    const minLocalTime = Time.local() - 600
    this.freeTxs.filter((item) => item.added > minLocalTime)
  }
  
  isFreeTxKnown(txHash) {
    this.deleteOldFreeTxs()
    return this.freeTxs.indexOf('hash', txHash) >= 0
  }
  
  addFreeTx(tx) {
    this.deleteOldFreeTxs()
    this.freeTxs.push({hash: tx.getHash(), data: tx.getRawData(), added: Time.local()}, {data: tx.getRawDataLength()})
    this.emit('changed')
  }
  
  deleteFreeTx(txHash) {
    const index = this.freeTxs.indexOf('hash', txHash)
    if (index >= 0) {
      this.freeTxs.remove(index)
      this.emit('changed')
      return true
    } else {
      return false
    }
  }
  
  eachFreeTx(itemCallback, returnCallback) {
    this.freeTxs.clone().eachAsync(itemCallback, returnCallback)
  }
  
  rEachFreeTx(itemCallback, returnCallback) {
    this.freeTxs.clone().rEachAsync(itemCallback, returnCallback)
  }
  
  eachAddressOut(itemCallback, returnCallback) {
    this.addressOuts.eachAsync(itemCallback, returnCallback)
  }
  
  each(itemCallback, returnCallback, returnDefault = null, allowableLockCount = 0) {
    // using whenUnlocked due to this.length
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.each()')
      
      unlock()
      this.eachTo(this.length, itemCallback, returnCallback, returnDefault, allowableLockCount)
    }, allowableLockCount)
  }
  
  // maxId - not including
  eachTo(maxId, itemCallback, returnCallback, returnDefault = null, allowableLockCount = 0) {
    this.eachFromTo(0, maxId, itemCallback, returnCallback, returnDefault, allowableLockCount)
  }
  
  // minId - including, maxId - not including
  eachFromTo(minId, maxId, itemCallback, returnCallback, returnDefault = null, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.eachFromTo()')
      
      const fromId = Math.max(0, minId)
      const toId = Math.min(this.length, maxId)
      
      if (fromId >= toId) {
        unlock()
        returnCallback && returnCallback()
        return
      }
      
      const {indexCached} = this
      let hashNext
      let startNext
      let fd
      let finished
      let id = fromId
      
      const readNext = () => {
        const hash = hashNext || indexCached.readBuffer(32)
        const start = startNext || indexCached.readUInt(8)
        
        if (id < toId) {
          if (indexCached.untilEnd()) {
            hashNext = indexCached.readBuffer(32)
            startNext = indexCached.readUInt(8)
          } else {
            startNext = this.dataSize
          }
          const size = startNext - start
          
          const buffer = Buffer.allocUnsafe(size)
          fs.read(fd, buffer, 0, size, start, (err) => {
            if (err) {
              throw err
            }
            itemCallback({id, hash, data: buffer}, (res) => {
              if (res !== undefined) {
                finished(() => {
                  returnCallback && returnCallback(res)
                })
              } else {
                id++
                setImmediate(() => {
                  readNext()
                })
              }
            })
          })
        } else {
          finished(() => {
            returnCallback && returnCallback(returnDefault)
          })
        }
      }
      
      indexCached.seek(fromId * 40)
      fs.open(PATH_DAT, 'r', (err, fdOpened) => {
        if (err) {
          throw err
        }
        fd = fdOpened
        finished = (callback) => {
          fs.close(fd, (err) => {
            if (err) {
              throw err
            }
            unlock()
            callback()
          })
        }
        readNext()
      })
    }, allowableLockCount)
  }
  
  // minId - including, maxId - not including
  rEachFromTo(maxId, minId, itemCallback, returnCallback, returnDefault = null, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.rEachFromTo()')
      
      const fromId = Math.min(this.length, maxId)
      const toId = Math.max(0, minId)
      
      if (fromId <= toId) {
        unlock()
        returnCallback && returnCallback()
        return
      }
      
      const {indexCached} = this
      let startPrev
      let fd
      let finished
      let id = fromId - 1
      
      const readNext = () => {
        let startNext
        let start
        if (id >= toId) {
          indexCached.forward(-40)
          const hash = indexCached.readBuffer(32)
          const start = indexCached.readUInt(8)
          
          if (startPrev) { // cannot be 0
            startNext = startPrev
          } else if (indexCached.untilEnd()) {
            indexCached.forward(32)
            startNext = indexCached.readUInt(8)
            indexCached.forward(-40)
          } else {
            startNext = this.dataSize
          }
          indexCached.forward(-40)
          const size = startNext - start
          
          const buffer = Buffer.allocUnsafe(size)
          fs.read(fd, buffer, 0, size, start, (err) => {
            if (err) {
              throw err
            }
            itemCallback({id, hash, data: buffer}, (res) => {
              if (res !== undefined) {
                finished(() => {
                  returnCallback && returnCallback(res)
                })
              } else {
                id--
                setImmediate(() => {
                  readNext()
                })
              }
            })
          })
        } else {
          finished(() => {
            returnCallback && returnCallback(returnDefault)
          })
        }
      }
      
      indexCached.seek(fromId * 40)
      fs.open(PATH_DAT, 'r', (err, fdOpened) => {
        if (err) {
          throw err
        }
        fd = fdOpened
        finished = (callback) => {
          fs.close(fd, (err) => {
            if (err) {
              throw err
            }
            unlock()
            callback()
          })
        }
        readNext()
      })
    }, allowableLockCount)
  }
  
  addTime(timeInfo, appendTail = true) {
    const tail = this.blockTimes.push(timeInfo)
    appendTail && this.blockTimesTail.addBuffer(tail)
  }
  
  addCoin(address) {
    const index = this.coins.indexOf('address', address)
    if (index === -1) {
      this.coins.push({address, count: 1})
    } else {
      this.coins.replace(index, {address, count: this.coins.get(index).count + 1})
    }
  }
  
  subCoin(address) {
    const index = this.coins.indexOf('address', address)
    if (index === -1) {
      throw new Error('Error in blockchain cache')
    } else {
      const count = this.coins.get(index).count - 1
      if (count) {
        this.coins.replace(index, {address, count})
      } else {
        this.coins.remove(index)
      }
    }
  }
  
  addAddressOut(addressOut) {
    const pos = Sorted.indexBA(this.addressOuts, addressOut.txHash, Sorted.compareBuffers, 'txHash')
    this.addressOuts.push(addressOut, pos)
  }
  
  loadCached(path, key, callback) {
    fs.readFile(path, (err, buffer) => {
      if (err) {
        callback && callback(false)
      } else {
        this[key].setWhole(buffer)
        callback && callback(true)
      }
    })
  }
  
  loadCacheIfExists(callback) {
    if (storage.blockchainCached) {
      db.each("SELECT COUNT(DISTINCT(block_height)) cnt FROM txs", [], ({cnt}) => {
        if (cnt === this.length) {
          this.loadCached(PATH_TIMES, 'blockTimes', (loaded) => {
            if (loaded) {
              this.loadCached(PATH_COINS, 'coins', (loaded) => {
                if (loaded) {
                  if (this.length) {
                    if (!this.blockTimes.getLength() || this.blockTimes.get(this.blockTimes.getLength() - 1).id !== this.length - 1) {
                      callback && callback(false)
                      return
                    }
                  }
                  this.cached = true
                  callback && callback(true)
                } else {
                  callback && callback(false)
                }
              })
            } else {
              callback && callback(false)
            }
          })
        } else {
          callback && callback(false)
        }
      })
    } else {
      callback && callback(false)
    }
  }
  
  cache(callbacks) {
    const Block = require('./Block')
    
    this.blockTimes.clear()
    this.coins.clear()
    
    this.spends = {}
    
    db.bigQueryStart("INSERT INTO txs (block_height, hash) VALUES ", '(?,?)', ',')
    db.bigQueryStart("INSERT INTO outs (block_height, tx_hash, out_n, address, amount, spent_at) VALUES ", '(?,?,?,?,?,?)', ',')
    db.clear()
      .then(() => db.begin())
      .then(() => {
        this.rEachFromTo(this.length, 0, ({id, hash, data}, toReturn) => {
          if (!(id % 100)) {
            callbacks && callbacks.onProgress && callbacks.onProgress((this.length - id) * 100 / this.length >> 0)
          }
          const block = Block.fromRaw(hash, data)
          const blockUnpacked = block.getData()
          this.addTime({id, time: blockUnpacked.time}, false)
          this.addCoin(this.getMinerAddressFromBlock(block))
          this.addBlockToDbQueued(id, block)
            .then(toReturn)
        }, () => db.bigQueryEnd("INSERT INTO txs (block_height, hash) VALUES ").then(() => db.bigQueryEnd("INSERT INTO outs (block_height, tx_hash, out_n, address, amount, spent_at) VALUES ")).then(() => db.commit()).then(() => {
          disp.lockTerm()
          storage.blockchainCached = false
          storage.flush(() => {
            this.blockTimes.reverse()
            this.writeBlockTimesCache()
            .then(() => this.writeCoinsCache())
            .then(() => {
              storage.blockchainCached = true
              storage.flush(() => {
                disp.unlockTerm()
                this.cached = true
                callbacks && callbacks.onReady && callbacks.onReady()
              })
            })
          })
        }))
      })
  }
  
  saveCheckpoint(callback) {
    const name = storage.lastCheckpoint && storage.lastCheckpoint === '1' ? '2' : '1'
    const path = PATH_CHECKPOINTS + name + '/'
    Files.removeDir(path)
      .then(() => {
        Files.needDir(path, () => {
          this.whenUnlocked((unlock) => {
            this.logBy('LCK', 'Locked by Blockchain.saveCheckpoint()')
            
            disp.lockTerm()
            new Promise((resolve) => {
              this.eachPlugin((instance, next) => {
                instance.onBeforeSaveCheckpoint(next)
              }, () => {
                resolve()
              })
            })
              .then(() => Files.copy(PATH_IND, path + NAME_IND))
              .then(() => Files.copy(PATH_DAT, path + NAME_DAT))
              .then(() => Files.copy(PATH_TIMES, path + NAME_TIMES))
              .then(() => Files.copy(PATH_COINS, path + NAME_COINS))
              .then(() => db.saveCheckpoint(path))
              .then(() => new Promise((resolve) => {
                this.eachPlugin((instance, next) => {
                  instance.onSaveCheckpoint(path, next)
                }, () => {
                  resolve()
                })
              }))
              .then(() => Files.touch(path + 'ready'))
              .then(() => {
                storage.lastCheckpoint = name
                storage.flush(() => {
                  disp.unlockTerm()
                  unlock()
                  this.log('{green-fg}Checkpoint ' + name + ' saved{/green-fg}')
                  callback && callback()
                })
              })
          })
        })
      })
  }
  
  loadCheckpoint(callback) {
    if (!storage.lastCheckpoint) {
      callback && callback(false)
      return
    }
    
    const name = storage.lastCheckpoint
    const path = PATH_CHECKPOINTS + name + '/'
    if (fs.existsSync(path + 'ready')) {
      disp.lockTerm()
      Files.copyBack(PATH_IND, path + NAME_IND)
      .then(() => Files.copyBack(PATH_DAT, path + NAME_DAT))
      .then(() => Files.copyBack(PATH_TIMES, path + NAME_TIMES))
      .then(() => Files.copyBack(PATH_COINS, path + NAME_COINS))
      .then(() => db.loadCheckpoint(path))
      .then(() => new Promise((resolve) => {
        this.eachPlugin((instance, next) => {
          instance.onLoadCheckpoint(path, next)
        }, () => {
          resolve()
        })
      }))
      .then(() => {
        storage.blockchainCached = true
        storage.flush(() => {
          disp.unlockTerm()
          callback && callback(true)
        })
      })
    } else {
      callback && callback(false)
    }
  }
  
  check(callbacks) {
    let prevHash
    this.each(({id, hash, data}, toReturn) => {
      if (!(id % 100)) {
        callbacks && callbacks.onProgress && callbacks.onProgress(id * 100 / this.length >> 0)
      }
      const prevBlockMustBe = id ? prevHash : INITIAL_PREV_BLOCK
      if (!data.slice(1, 33).equals(prevBlockMustBe)) {
        toReturn(id)
        return
      }
      
      prevHash = hash
      toReturn()
    }, (res) => {
      callbacks && callbacks.onReady && callbacks.onReady(res)
    }, -1)
  }
  
  checkCacheTimes(callbacks) {
    let prevId = -1
    let prevTime = 0
    this.blockTimes.eachAsync((data, i, raw, next) => {
      if (!(i % 100)) {
        callbacks && callbacks.onProgress && callbacks.onProgress(i * 100 / this.blockTimes.getLength() >> 0)
      }
      
      if (data.id <= prevId) {
        callbacks && callbacks.onReady && callbacks.onReady(false, 'Block #' + data.id + ' after ' + prevId)
      } else if (data.time < prevTime - 60) {
        callbacks && callbacks.onReady && callbacks.onReady(false, 'Block #' + data.id + ' time ' + data.time + ' after ' + prevTime)
      } else {
        prevId = data.id
        prevTime = data.time
        next()
      }
    }, () => {
      callbacks && callbacks.onReady && callbacks.onReady(true)
    }, -1)
  }
  
  getLength(callback, allowableLockCount = 0) {
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.getLength()')
      
      unlock()
      callback(this.length)
    }, allowableLockCount)
  }
  
  getInitialPrevBlock() {
    return INITIAL_PREV_BLOCK
  }
}

const blockchain = new Blockchain
module.exports = blockchain