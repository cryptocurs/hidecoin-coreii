'use strict'

const fs = require('fs')
const R = require('ramda')

const {Probable, Time} = require('./helpers')
const disp = require('./Disp')
const storage = require('./Storage')
const Component = require('./Component')
const blockchain = require('./Blockchain')
const net = require('./Net')

const COUNT_PER_REQUEST = 64
const {RESPONSE_NO_BLOCK, RESPONSE_NO_BLOCK_AFTER} = net.getConstants()

class Synchronizer extends Component {

  constructor() {
    super()
    this.module = 'SNC'
    this.lockSync = false
    this.netInfoBlockchainLengths = {}
    this.firstSyncCallback = null
    this.synchronizing = false
    
    storage.session.synchronizer = {promiscuous: true, firstReady: false, ready: false, lastBlockAdded: Time.local(), netInfoBlockchainLength: null}
    
    disp.on('sigTerm', () => {
      this.lockSync = true
    })
    
    setInterval(() => {
      if (storage.session.synchronizer.lastBlockAdded < Time.local() - 120) {
        this.log('{yellow-fg}Scheduled synchronization...{/yellow-fg}')
        this.sync()
      }
    }, 10000)
    
    setTimeout(() => {
      Time.doNowAndSetInterval(() => {
        net.requestBlockchainLength((err, res) => {
          if (!err) {
            if (res.blockchainLength >= storage.session.blockchain.length) {
              this.netInfoBlockchainLengths[res.address] = res.blockchainLength
              storage.session.synchronizer.netInfoBlockchainLength = Probable.calc(R.values(this.netInfoBlockchainLengths))
            }
          }
        })
      }, 30000)
    }, 5000)
    
    this.sync = () => {
      if (this.synchronizing) {
        this.log('{red-fg}Synchronizer is busy{/red-fg}')
        return
      }
      
      const syncNext = () => {
        setImmediate(() => {
          this.sync()
        })
      }
      
      this.log('Partial synchronization {yellow-fg}STARTED{/yellow-fg}')
      this.synchronizing = true
      storage.session.synchronizer.ready = false
      blockchain.getPrevBlockForNextBlock((hash) => {
        let added = 0
        let noBlockAfterCount = 0
        let isFork = false
        this.log('isFork = false')
        net.requestBlocksAfter(hash, COUNT_PER_REQUEST, (err, res) => {
          if (err) {
            if (err === RESPONSE_NO_BLOCK) {
              !isFork && blockchain.getLength((blockchainLength) => {
                this.log('{yellow-fg}NO_BLOCK, diff ' + (res.blockchainLength - blockchainLength) + '{/yellow-fg}')
                if (res.blockchainLength > blockchainLength) {
                  isFork = true
                  this.log('isFork = true')
                }
              })
            } else if (err === RESPONSE_NO_BLOCK_AFTER) {
              this.log('{yellow-fg}NO_BLOCK_AFTER{/yellow-fg}')
              noBlockAfterCount++
            }
          } else {
            blockchain.whenUnlocked((unlock) => {
              this.logBy('LCK', 'Locked by Synchronizer.sync()[Received blocks]')
              blockchain.getLength((blockchainLength) => {
                blockchain.workWithCache((changed, finished) => {
                  const ready = () => {
                    this.logAlias('synchronizing', 'Waiting for next blocks...')
                    finished()
                  }
                  
                  res.eachBlock((block, next) => {
                    if (this.lockSync) {
                      ready()
                      return
                    }
                    
                    if (added === COUNT_PER_REQUEST) {
                      ready()
                      return
                    }
                    
                    this.logAlias('synchronizing', 'Validating block ' + (added + 1) + '...')
                    
                    if (block) {
                      block.isValidAfter(blockchainLength - 1, (valid, err) => {
                        if (valid) {
                          net.clearRequestBlocksAfter()
                          blockchain.add(block, () => {
                            storage.session.synchronizer.lastBlockAdded = Time.local()
                            added++
                            blockchainLength++
                            changed()
                            next()
                          }, 1)
                        } else {
                          // next()
                          this.log('Error:', err)
                          ready()
                        }
                      }, 1)
                    } else {
                      ready()
                    }
                  }, 1)
                }, () => {
                  unlock()
                })
              }, 1)
            })
          }
        }, () => {
          // wait for eachBlock
          this.log('Waiting for blockchain processes...')
          blockchain.whenUnlocked((unlock) => {
            unlock()
            this.synchronizing = false
            this.log('Partial synchronization {green-fg}FINISHED{/green-fg}')
            this.log('{cyan-fg}Added: ' + added + ', NBA: ' + noBlockAfterCount + ', fork: ' + (isFork ? 'true' : 'false') + '{/cyan-fg}')
            if (added) {
              syncNext()
            } else {
              if (noBlockAfterCount) {
                this.logAliasClear('synchronizing')
                this.log('{green-fg}Blockchain synchronized{/green-fg}')
                if (!storage.session.synchronizer.firstReady) {
                  storage.session.synchronizer.promiscuous = false
                  storage.session.synchronizer.firstReady = true
                  this.firstSyncCallback && this.firstSyncCallback()
                }
                storage.session.synchronizer.ready = true
              } else if (isFork) {
                this.log('{red-fg}!!! FORK !!!{/red-fg}')
                this.logBy('COL', '{red-fg}!!! FORK !!!{/red-fg}')
                blockchain.whenUnlocked((unlock) => {
                  this.logBy('LCK', 'Locked by Synchronizer.sync()[isFork]')
                  blockchain.getLength((blockchainLength) => {
                    if (blockchainLength) {
                      blockchain.workWithCache((changed, finished) => {
                        const toDelete = Math.min(8, blockchainLength)
                        blockchain.removeLast(toDelete, () => {
                          changed(true)
                          finished()
                        }, 1)
                      }, () => {
                        unlock()
                        syncNext()
                      })
                    } else {
                      unlock()
                      syncNext()
                    }
                  }, 1)
                })
              } else {
                syncNext()
              }
            }
          })
        })
      })
    }
  }
  
  run(callback) {
    this.firstSyncCallback = callback
    this.sync()
  }
}

const synchronizer = new Synchronizer
module.exports = synchronizer