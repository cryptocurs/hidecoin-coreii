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
    this.waitForBlocksAfterHash = null
    this.waitForBlocksAfterTimer = null
    this.lockSync = false
    this.netInfoBlockchainLengths = {}
    this.firstSyncCallback = null
    
    storage.session.synchronizer = {promiscuous: true, firstReady: false, ready: false, lastBlockAdded: Time.local(), netInfoBlockchainLength: null}
    
    disp.on('sigTerm', () => {
      this.lockSync = true
    })
    
    setInterval(() => {
      if (storage.session.synchronizer.lastBlockAdded < Time.local() - 120) {
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
      storage.session.synchronizer.ready = false
      blockchain.getPrevBlockForNextBlock((hash) => {
        let added = 0
        let noBlockAfterCount = 0
        let isFork = false
        net.requestBlocksAfter(hash, COUNT_PER_REQUEST, (err, res) => {
          if (err) {
            if (err === RESPONSE_NO_BLOCK) {
              !isFork && blockchain.getLength((blockchainLength) => {
                if (res.blockchainLength > blockchainLength) {
                  isFork = true
                }
              })
            } else if (err === RESPONSE_NO_BLOCK_AFTER) {
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
                      setImmediate(() => {
                        this.sync()
                      })
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
                      setImmediate(() => {
                        this.sync()
                      })
                    }
                  }, 1)
                }, () => {
                  unlock()
                })
              }, 1)
            })
          }
        }, () => {
          if (!added) {
            if (noBlockAfterCount) {
              this.logAliasClear('synchronizing')
              this.log('{green-fg}Blockchain synchronized{/green-fg}')
              net.clearRequestBlocksAfter()
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
                      blockchain.removeLast(1, () => {
                        changed(true)
                        finished()
                      }, 1)
                    }, () => {
                      unlock()
                      setImmediate(() => {
                        this.sync()
                      })
                    })
                  } else {
                    unlock()
                  }
                }, 1)
              })
            }
          }
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