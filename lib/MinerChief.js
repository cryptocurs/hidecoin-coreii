'use strict'

const R = require('ramda')

const {Conv, Random, Time} = require('./helpers')
const storage = require('./Storage')
const Component = require('./Component')
const Address = require('./Address')
const blockchain = require('./Blockchain')
const Block = require('./Block')
const Tx = require('./Tx')
const blockProcessor = require('./BlockProcessor')
const {BLOCK_HEADER_LENGTH} = require('./Constants')

class MinerChief extends Component {

  constructor() {
    super()
    this.module = 'MNR'
    this.rejectBlocks = false
    this.updatingTask = false
    this.task = {
      active: 0
    }
    storage.session.miner = {task: this.task}
    
    setInterval(() => {
      if (this.task.active) {
        this.block.setTime(Time.global())
      }
    }, 10000)
    
    storage.on('rpcMinerBlockFound', (hashData, blockData, txHashList) => {
      if (this.rejectBlocks) {
        return
      }
      
      const hash = Conv.baseToBuf(hashData)
      const data = Conv.baseToBuf(blockData)
      
      this.logBy('FND', 'New block found', Conv.bufToHex(hash))
      
      this.rejectBlocks = true
      this.task.active = 0
      storage.session.miner = {task: {active: 0}}
      
      blockProcessor.add(hash, data, 'FND')
      
      setTimeout(() => {
        this.rejectBlocks = false
        this.block.setTime(Time.global())
        this.task.active = 1
        storage.session.miner.task = this.task
      }, 2000)
    })
    
    storage.on('rpcBlockConfirmationsCount', (hash, callback) => {
      blockchain.whenUnlocked((unlock) => {
        this.logBy('LCK', 'Locked by MinerChief:storage.on(rpcBlockConfirmationsCount)')
        blockchain.getBlockIdByHash(Conv.hexToBuf(hash), (id) => {
          if (id === -1) {
            unlock()
            callback(-1)
          } else {
            blockchain.getLength((blockchainLength) => {
              unlock()
              callback(blockchainLength - 1 - id)
            }, 1)
          }
        }, 1)
      })
    })
  }
  
  updateTask(lastBlock, lastBlockId) {
    if (!this.updatingTask && lastBlockId >= 0 && storage.config.miner && storage.config.miner.addresses && storage.config.miner.addresses.length) {
      this.updatingTask = true
      
      this.block = Block.create()
      const lastBlockData = lastBlock.getData()
      const blockId = lastBlockId + 1
      const blockDiff = Block.calcDiff(blockId, lastBlockData.diff, blockchain.getCountByTime(lastBlockData.time - 3600, lastBlockData.time))
      const blockReward = Tx.calcBlockReward(blockId)
      const address = Random.item(storage.config.miner.addresses)
      
      this.block.setPrevBlock(lastBlock.getHash())
      this.block.setTime(Time.global())
      this.block.setDiff(blockDiff)
      
      let size = BLOCK_HEADER_LENGTH
      let feeSum = 0
      blockchain.eachFreeTx(({hash, data}, i, raw, next) => {
        const txSize = data.length + 36
        if (txSize <= 1048576 - size) {
          const tx = Tx.fromRaw(hash, data)
          blockchain.whenUnlocked((unlock) => {
            this.logBy('LCK', 'Locked by MinerChief.updateTask:eachFreeTx()')
            tx.isValidAfter(lastBlockId, this.block.getData(), {}, (valid, err, fee) => {
              if (valid) {
                this.block.addTx(tx)
                feeSum += fee
                size += txSize
              } else {
                blockchain.deleteFreeTx(hash)
              }
              unlock()
              next()
            }, 1)
          })
        } else {
          next()
        }
      }, () => {
        blockchain.getLength((blockchainLength) => {
          const reward = Tx.calcBlockReward(blockchainLength) + feeSum
          
          const basicTx = Tx.create()
          basicTx.setTime(Time.global())
          basicTx.addOut(Address.hashToRaw(address), blockReward + feeSum)
          this.block.addFirstTx(basicTx)
          
          const txHashList = []
          this.block.getData().txHashList.each(({hash}) => {
            txHashList.push(Conv.bufToBase(hash))
          })
          
          storage.session.stat.txs = txHashList.length
          storage.session.stat.bsz = this.block.getRawDataLength()
          
          this.task = {
            active: 1,
            blockHeaderSize: this.block.getHeaderLength(),
            blockData: Conv.bufToBase(this.block.getRawData()),
            txHashList,
            reward
          }
          storage.session.miner.task = this.task
          
          this.updatingTask = false
          this.log('Task updated, block reward', reward)
        })
      })
    }
  }
}

const minerChief = new MinerChief
module.exports = minerChief