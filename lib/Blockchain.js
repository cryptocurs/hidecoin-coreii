'use strict'

/* TODO:
*  use lastBlocksHashesIds (to get hash) and lastBlocksIdsData (to get data) in getRaw()
*  deleteOldFreeTxs() need this.emit('changed') ???
*/

const fs = require('fs')

const {Asyncs, Files, Sorted, Time} = require('./helpers')
const disp = require('./Disp')
const storage = require('./Storage')
const Component = require('./Component')
const BufferArray = require('./BufferArray')
const ScalableBufferArray = require('./ScalableBufferArray')
const SteppedBuffer = require('./SteppedBuffer')
const {BLOCK_HEADER_LENGTH, BLOCK_MINIMAL_LENGTH} = require('./Constants')

const BASE_PATH = __dirname + '/../data/'
const PATH_CHECKPOINTS = BASE_PATH + 'checkpoints/'
const NAME_IND = 'blockchain.ind'
const NAME_DAT = 'blockchain.dat'
const NAME_SPENDS = 'spends.cache'
const NAME_TXMAP = 'txmap.cache'
const NAME_TIMES = 'times.cache'
const NAME_COINS = 'coins.cache'
const PATH_IND = BASE_PATH + NAME_IND
const PATH_DAT = BASE_PATH + NAME_DAT
const PATH_SPENDS = BASE_PATH + NAME_SPENDS
const PATH_TXMAP = BASE_PATH + NAME_TXMAP
const PATH_TIMES = BASE_PATH + NAME_TIMES
const PATH_COINS = BASE_PATH + NAME_COINS

const INITIAL_PREV_BLOCK = Buffer.from('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 'hex')

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
    if (!storage.plugins.blockchain) {
      storage.plugins.blockchain = []
    }
    
    this.spends = BufferArray({
      step: 65536,
      fields: {
        blockId: {type: 'number', size: 4},
        txInHash: {type: 'buffer', size: 32},
        txInOutN: {type: 'number', size: 4},
        txHash: {type: 'buffer', size: 32}
      }
    })
    this.txMap = BufferArray({
      step: 65536,
      fields: {
        blockId: {type: 'number', size: 4},
        txHash: {type: 'buffer', size: 32}
      }
    })
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
    
    this.txMapTail = SteppedBuffer(16384)
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
    
    this.writeSpendsCache = (callback) => {
      this.log('{yellow-fg}Saving spends.cache...{/yellow-fg}')
      fs.writeFile(PATH_SPENDS, this.spends.getWhole(), (err) => {
        if (err) {
          throw err
        }
        callback && callback()
      })
    }
    
    this.writeTxMapCache = (callback) => {
      this.log('{yellow-fg}Saving txmap.cache...{/yellow-fg}')
      fs.writeFile(PATH_TXMAP, this.txMap.getWhole(), (err) => {
        if (err) {
          throw err
        }
        callback && callback()
      })
    }
    
    this.writeBlockTimesCache = (callback) => {
      this.log('{yellow-fg}Saving times.cache...{/yellow-fg}')
      fs.writeFile(PATH_TIMES, this.blockTimes.getWhole(), (err) => {
        if (err) {
          throw err
        }
        callback && callback()
      })
    }
    
    this.writeCoinsCache = (callback) => {
      this.log('{yellow-fg}Saving coins.cache...{/yellow-fg}')
      fs.writeFile(PATH_COINS, this.coins.getWhole(), (err) => {
        if (err) {
          throw err
        }
        callback && callback()
      })
    }
    
    this.appendTxMapCacheIfNeeded = (callback) => {
      this.log('{yellow-fg}Appending txmap.cache...{/yellow-fg}')
      if (this.txMapTail.getLength()) {
        fs.appendFile(PATH_TXMAP, this.txMapTail.getWhole(), (err) => {
          if (err) {
            throw err
          }
          callback && callback()
        })
      } else {
        this.log('{red-fg}txmap tail is empty{/red-fg}')
        callback && callback()
      }
    }
    
    this.appendBlockTimesCacheIfNeeded = (callback) => {
      this.log('{yellow-fg}Appending times.cache...{/yellow-fg}')
      if (this.blockTimesTail.getLength()) {
        fs.appendFile(PATH_TIMES, this.blockTimesTail.getWhole(), (err) => {
          if (err) {
            throw err
          }
          callback && callback()
        })
      } else {
        this.log('{red-fg}times tail is empty{/red-fg}')
        callback && callback()
      }
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
    
    this.txMapTail.clear()
    this.blockTimesTail.clear()
    
    disp.lockTerm()
    storage.blockchainCached = false
    storage.flush(() => {
      let isChanged = 0
      startCallback((rewrite = false) => {
        isChanged = rewrite ? 2 : 1
      }, () => {
        if (isChanged === 2) {
          this.writeSpendsCache(() => {
            this.writeTxMapCache(() => {
              this.writeBlockTimesCache(() => {
                this.writeCoinsCache(() => {
                  this.eachPlugin((instance, next) => {
                    instance.onSaveCache(next)
                  }, () => {
                    next()
                  })
                })
              })
            })
          })
        } else if (isChanged === 1) {
          this.writeSpendsCache(() => {
            this.appendTxMapCacheIfNeeded(() => {
              this.appendBlockTimesCacheIfNeeded(() => {
                this.writeCoinsCache(() => {
                  this.eachPlugin((instance, next) => {
                    instance.onSaveCache(next)
                  }, () => {
                    next()
                  })
                })
              })
            })
          })
        } else {
          next()
        }
      })
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
      blockUnpacked.txHashList.each(({hash: txHash}) => {
        this.addTxToMap({
          blockId,
          txHash
        })
      })
      this.addCoin(this.getMinerAddressFromBlock(block))
      for (const i in blockUnpacked.txList) {
        blockUnpacked.txList[i].getData().txIns.each((txIn) => {
          this.addSpend({
            blockId,
            txInHash: txIn.txHash,
            txInOutN: txIn.outN,
            txHash: blockUnpacked.txHashList.get(i).hash
          })
        })
      }
      this.deleteFreeTx(block.getHash())
      
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
    }, allowableLockCount)
  }
  
  removeLast(count, callback, allowableLockCount = 0) {
    const Block = require('./Block')
    
    this.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by Blockchain.removeLast()')
      
      this.eachFromTo(this.length - count, this.length, ({id, hash, data}, next) => {
        const address = this.getMinerAddressFromBlock(Block.fromRaw(hash, data))
        this.logBy('COL', 'DEBUG: Removing coin from #' + id + '. Was: ' + this.getMinedBlocksByAddress(address))
        this.subCoin(address)
        this.logBy('COL', 'DEBUG: Now: ' + this.getMinedBlocksByAddress(address))
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
        
        this.spends.filter(({blockId}) => blockId < this.length)
        this.txMap.filter(({blockId}) => blockId < this.length)
        this.blockTimes.filter(({id}) => id < this.length)
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
      
      const index = this.txMap.indexOf('txHash', hash)
      if (index === -1) {
        unlock()
        callback(null)
        return
      }
      
      const {blockId} = this.txMap.get(index)
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
  
  // maxBlockId - including
  isTxOutSpent(hash, outN, maxBlockId) {
    const indexes = Sorted.indexesOfBA(this.spends, hash, Sorted.compareBuffers, 'txInHash')
    for (const i in indexes) {
      const index = indexes[i]
      const {blockId, txInOutN, txHash} = this.spends.get(index)
      if (txInOutN === outN) {
        return blockId > maxBlockId ? null : {blockId, txHash}
      }
    }
    return null
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
          fs.read(fd, buffer, 0, size, start, (err, bytesRead, buffer) => {
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
  
  addSpend(spend) {
    const pos = Sorted.indexBA(this.spends, spend.txInHash, Sorted.compareBuffers, 'txInHash')
    this.spends.push(spend, pos)
  }
  
  addTxToMap(txInfo, appendTail = true) {
    const tail = this.txMap.push(txInfo)
    appendTail && this.txMapTail.addBuffer(tail)
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
      this.loadCached(PATH_SPENDS, 'spends', (loaded) => {
        if (loaded) {
          this.loadCached(PATH_TXMAP, 'txMap', (loaded) => {
            if (loaded) {
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
      })
    } else {
      callback && callback(false)
    }
  }
  
  cache(callbacks) {
    const Block = require('./Block')
    
    this.spends.clear()
    this.txMap.clear()
    this.blockTimes.clear()
    this.coins.clear()
    
    this.each(({id, hash, data}, toReturn) => {
      if (!(id % 100)) {
        callbacks && callbacks.onProgress && callbacks.onProgress(id * 100 / this.length >> 0)
      }
      if (data.length === BLOCK_MINIMAL_LENGTH) {
        const txHash = data.slice(BLOCK_HEADER_LENGTH, BLOCK_HEADER_LENGTH + 32)
        const time = data.readUIntBE(BLOCK_HEADER_LENGTH + 36, 8)
        const addressRaw = data.slice(BLOCK_HEADER_LENGTH + 56, BLOCK_HEADER_LENGTH + 81)
        
        this.addTime({id, time}, false)
        this.addTxToMap({
          blockId: id,
          txHash
        }, false)
        this.addCoin(addressRaw)
        toReturn()
        return
      }
      const block = Block.fromRaw(hash, data)
      const blockUnpacked = block.getData()
      this.addTime({id, time: blockUnpacked.time}, false)
      blockUnpacked.txHashList.each(({hash: txHash}) => {
        this.addTxToMap({
          blockId: id,
          txHash
        }, false)
      })
      this.addCoin(this.getMinerAddressFromBlock(block))
      for (const i in blockUnpacked.txList) {
        const tx = blockUnpacked.txList[i]
        let txUnpacked = tx.getData()
        txUnpacked.txIns.each((txIn) => {
          this.addSpend({
            blockId: id,
            txInHash: txIn.txHash,
            txInOutN: txIn.outN,
            txHash: blockUnpacked.txHashList.get(i).hash
          })
        })
      }
      toReturn()
    }, () => {
      disp.lockTerm()
      storage.blockchainCached = false
      storage.flush(() => {
        this.writeSpendsCache(() => {
          this.writeTxMapCache(() => {
            this.writeBlockTimesCache(() => {
              this.writeCoinsCache(() => {
                storage.blockchainCached = true
                storage.flush(() => {
                  disp.unlockTerm()
                  this.cached = true
                  callbacks && callbacks.onReady && callbacks.onReady()
                })
              })
            })
          })
        })
      })
    })
  }
  
  saveCheckpoint(name, callback) {
    const path = PATH_CHECKPOINTS + name + '/'
    Files.needDir(path, () => {
      this.whenUnlocked((unlock) => {
        this.logBy('LCK', 'Locked by Blockchain.saveCheckpoint()')
        
        disp.lockTerm()
        Files.copy(PATH_IND, path + NAME_IND)
        .then(() => Files.copy(PATH_DAT, path + NAME_DAT))
        .then(() => Files.copy(PATH_SPENDS, path + NAME_SPENDS))
        .then(() => Files.copy(PATH_TXMAP, path + NAME_TXMAP))
        .then(() => Files.copy(PATH_TIMES, path + NAME_TIMES))
        .then(() => Files.copy(PATH_COINS, path + NAME_COINS))
        .then(() => {
          disp.unlockTerm()
          unlock()
          callback && callback()
        })
      })
    })
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
  
  compareCacheFilesWithMemory(callback) {
    const res = {}
    fs.readFile(PATH_SPENDS, (err, data) => {
      if (err) {
        throw err
      }
      res.spends = data.equals(this.spends.getWhole())
        fs.readFile(PATH_TXMAP, (err, data) => {
        if (err) {
          throw err
        }
        setTimeout(() => {
          this.log(data.length, this.txMap.getWhole().length)
        }, 100)
        res.txMap = data.equals(this.txMap.getWhole())
        fs.readFile(PATH_TIMES, (err, data) => {
          if (err) {
            throw err
          }
          res.times = data.equals(this.blockTimes.getWhole())
          fs.readFile(PATH_COINS, (err, data) => {
            if (err) {
              throw err
            }
            res.coins = data.equals(this.coins.getWhole())
            callback && callback(res)
          })
        })
      })
    })
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