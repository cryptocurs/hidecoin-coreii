'use strict'

const R = require('ramda')
const _ = require('lodash')

const {Random, Time} = require('./helpers')
const disp = require('./Disp')
const storage = require('./Storage')
const Component = require('./Component')
const Address = require('./Address')
const blockchain = require('./Blockchain')
const Block = require('./Block')
const Tx = require('./Tx')
const ifc = require('./Interface')
const p2p = require('./P2P')
const p2x = require('./P2X')
const net = require('./Net')
const synchronizer = require('./Synchronizer')
const packageInfo = require('../package')
const minerChief = require('./MinerChief')

class App extends Component {

  constructor() {
    super()
    this.module = 'APP'
    this.rpcServer = null
    this.webWallet = null
  }
  
  run() {
    const dumpBuffer = (buf) => {
      let str = ''
      for (const Byte of buf) {
        str += _.padStart(Byte.toString(16), 2, '0') + ' '
      }
      return str
    }

    storage.session.appName = 'Hidecoin Core'
    storage.session.version = packageInfo.version
    storage.logIgnoreModules = {P2P: true, P2X: true, LCK: true}
    storage.on('fatalError', (error) => {
      disp.terminate(() => {
        ifc.close()
        console.log(error)
      })
    })

    ifc.open()
    ifc.key(['C-c', 'f10'], () => {
      ifc.openWindow('loading')
      ifc.updateWindow('loading', {info: 'Terminating...'})
      disp.terminate()
      setTimeout(() => {
        process.exit()
      }, 5000)
    })
    ifc.openWindow('loading')
    ifc.updateWindow('loading', {info: 'Synchronizing time...'})
    Time.synchronize((timeOffset) => {
      const next = () => {
        ifc.updateWindow('loading', {info: 'Saving checkpoint...'})
        blockchain.saveCheckpoint('basic', () => {
          ifc.updateWindow('loading', {info: 'Connecting to nodes...'})
          p2p.online(storage.config.net && storage.config.net.server && storage.config.net.server.port || 7438, () => {
            ifc.openWindow('app')
            
            setInterval(() => {
              storage.flush()
            }, 60000)
            
            blockchain.on('changed', () => {
              blockchain.getLastBlock((block, id) => {
                minerChief.updateTask(block, id)
              })
            })
            
            setTimeout(() => {
              blockchain.getLastBlock((block, id) => {
                minerChief.updateTask(block, id)
              })
            }, 1000)
            
            this.rpcServer = require('./RpcServer')
            this.walletUI = require('./WalletUI')
            
            let currentBox = 'console'
            let currentBlockId = null
            
            ifc.key('f1', () => {
              currentBox = 'console'
              ifc.updateWindow('app', {currentBox})
            })
            
            ifc.key('f2', () => {
              blockchain.whenUnlocked((unlock) => {
                blockchain.getLength((blockchainLength) => {
                  if (blockchainLength) {
                    currentBox = 'blocks'
                    blockchain.getBlockById(blockchainLength - 1, (block) => {
                      unlock()
                      currentBlockId = blockchainLength - 1
                      ifc.updateWindow('app', {currentBox, blockId: currentBlockId, block})
                    }, 1)
                  } else {
                    unlock()
                  }
                }, 1)
              })
            })
            
            ifc.key('left', () => {
              if (currentBox === 'blocks') {
                currentBlockId--
                const blockId = currentBlockId
                blockchain.getBlockById(currentBlockId, (block) => {
                  block && ifc.updateWindow('app', {currentBox: 'blocks', blockId, block})
                })
              }
            })
            
            ifc.key('right', () => {
              if (currentBox === 'blocks') {
                currentBlockId++
                const blockId = currentBlockId
                blockchain.getBlockById(currentBlockId, (block) => {
                  block && ifc.updateWindow('app', {currentBox: 'blocks', blockId, block})
                })
              }
            })
            
            ifc.key('f3', () => {
              currentBox = 'miner'
              ifc.updateWindow('app', {currentBox})
            })
            
            ifc.key('f4', () => {
              currentBox = 'wallet'
              ifc.updateWindow('app', {currentBox})
            })
            
            ifc.key('f5', () => {
              currentBox = 'collision'
              ifc.updateWindow('app', {currentBox})
            })
            
            ifc.key('f6', () => {
              ifc.updateWindow('app', {switchHeaderType: true})
            })
            
            ifc.key('f7', () => {
              const currentWindow = ifc.getCurrentWindow()
              if (currentWindow === 'app') {
                ifc.openWindow('wallet')
              } else if (currentWindow === 'wallet') {
                ifc.openWindow('app')
              }
            })
            
            ifc.key('f8', () => {
              const currentWindow = ifc.getCurrentWindow()
              if (currentWindow === 'app') {
                this.log('Nodes:', R.join(', ', R.keys(storage.servers)))
              } else if (currentWindow === 'wallet') {
                this.walletUI.showMenu('options')
              }
            })
            
            ifc.key('f9', () => {
              ifc.openWindow('loading')
              ifc.updateWindow('loading', {info: 'Checking blockchain...'})
              blockchain.check({
                onProgress: (progress) => {
                  ifc.updateWindow('loading', {info: 'Checking blockchain...' + progress + '%'})
                },
                onReady: (id) => {
                  ifc.openWindow('app')
                  if (id >= 0) {
                    this.log('Error since block #' + id)
                  }
                }
              })
            })
            
            ifc.key('f11', () => {
              ifc.openWindow('loading')
              ifc.updateWindow('loading', {info: 'Checking times.cache...'})
              blockchain.checkCacheTimes({
                onProgress: (progress) => {
                  ifc.updateWindow('loading', {info: 'Checking times.cache...' + progress + '%'})
                },
                onReady: (valid, info) => {
                  ifc.openWindow('app')
                  if (valid) {
                    this.log('times.cache is valid')
                  } else {
                    this.log('times.cache is NOT valid: ' + info)
                  }
                }
              })
            })
            
            ifc.key('f12', () => {
              ifc.openWindow('loading')
              ifc.updateWindow('loading', {info: 'Checking times.cache...'})
              blockchain.compareCacheFilesWithMemory((res) => {
                ifc.openWindow('app')
                this.log(res)
              })
            })
            
            ifc.key('C-l', () => {
              if (storage.logTrackModule) {
                storage.logIgnoreModules.LCK = true
                storage.logTrackModule = undefined
              } else {
                storage.logIgnoreModules.LCK = false
                storage.logTrackModule = 'LCK'
              }
            })
            
            this.log('Synchronizing blockchain...')
            synchronizer.run(() => {
              
            })
          })
        })
      }
      
      blockchain.loadCacheIfExists((loaded) => {
        if (loaded) {
          next()
        } else {
          ifc.updateWindow('loading', {info: 'Caching blockchain (first run of program)...'})
          blockchain.cache({
            onProgress: (progress) => {
              ifc.updateWindow('loading', {info: 'Caching blockchain (first run of program)...' + progress + '%'})
            },
            onReady: () => {
              next()
            }
          })
        }
      })
    })
  }
}

const app = new App
module.exports = app