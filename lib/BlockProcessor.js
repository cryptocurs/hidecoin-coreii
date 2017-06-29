'use strict'

const {Conv, Time} = require('./helpers')
const storage = require('./Storage')
const Component = require('./Component')
const blockchain = require('./Blockchain')
const Block = require('./Block')

class BlockProcessor extends Component {

  constructor() {
    super()
    this.module = 'BLP'
    
    this.broadcast = (hash, data) => {
      const net = require('./Net')
      net.broadcastBlockFound(hash, data)
    }
  }
  
  add(hash, rawData, module = null) {
    blockchain.getBlockIdByHash(hash, (id) => {
      if (id === -1) {
        blockchain.whenUnlocked((unlock) => {
          this.logBy('LCK', 'Locked by BlockProcessor.add()')
          blockchain.getLength((blockchainLength) => {
            blockchain.getBlockIdByHash(rawData.slice(1, 33), (id) => {
              if (id >= blockchainLength - 2) {
                const block = Block.fromRaw(hash, rawData)
                block.isValidAfter(id, (valid, err) => {
                  if (valid) {
                    if (id === blockchainLength - 1) {
                      blockchain.workWithCache((changed, finished) => {
                        blockchain.add(block, () => {
                          this.logBy(module || this.module, '{green-fg}New block ACCEPTED{/green-fg}')
                          storage.session.synchronizer.lastBlockAdded = Time.local()
                          changed()
                          finished()
                          
                          this.broadcast(hash, rawData)
                        }, 1)
                      }, () => {
                        unlock()
                      })
                    } else {
                      // collision
                      const newBlock = Block.fromRaw(hash, rawData)
                      blockchain.getBlockById(id, (existingBlock) => {
                        const acceptNewBlock = () => {
                          blockchain.workWithCache((changed, finished) => {
                            blockchain.removeLast(1, () => {
                              blockchain.add(newBlock, () => {
                                changed(true)
                                finished()
                                
                                this.broadcast(hash, rawData)
                              }, 1)
                            }, 1)
                          }, () => {
                            unlock()
                          })
                        }
                        
                        const newMined = blockchain.getMinedBlocksByAddress(blockchain.getMinerAddressFromBlock(newBlock))
                        const existingMined = blockchain.getMinedBlocksByAddress(blockchain.getMinerAddressFromBlock(existingBlock))
                        this.logBy(module || 'COL', 'New', Conv.bufToHex(newBlock.getHash().slice(0, 8)), '(' + newMined + ')', 'Exs', Conv.bufToHex(existingBlock.getHash().slice(0, 8)), '(' + existingMined + ')')
                        if (newMined > existingMined) {
                          this.logBy(module || 'COL', '{yellow-fg}New block won (more mined blocks){/yellow-fg}')
                          acceptNewBlock()
                          return
                        } else if (newMined === existingMined && newBlock.getHash().compare(existingBlock.getHash()) === -1) {
                          this.logBy(module || 'COL', '{yellow-fg}New block won (hash less){/yellow-fg}')
                          acceptNewBlock()
                          return
                        }
                        
                        this.logBy(module || 'COL', '{green-fg}Existing block won{/green-fg}')
                        unlock()
                      }, 1)
                    }
                  } else {
                    this.log(module || 'COL', '{red-fg}New block REJECTED: ' + err + '{/red-fg}')
                    unlock()
                  }
                }, 1)
              } else {
                unlock()
              }
            }, 1)
          }, 1)
        })
      }
    })
  }
}

const blockProcessor = new BlockProcessor
module.exports = blockProcessor