'use strict'

/*
*  TAKE_BLOCKS_AFTER              from 40 bytes
*    int(1)    flags:
*      FLAG_ZIPPED 0x01
*    buf(32)   afterHash
*    int(4)    afterId
*    int(2)    blockCount
*    BLOCKS
*      buf(32)   hash
*      int(4)    dataLength
*      buf       data
*    if FLAG_ZIPPED then
*      zlib(BLOCKS)
*/

const zlib = require('zlib')

const Component = require('../Component')
const blockchain = require('../Blockchain')
const Block = require('../Block')
const SteppedBuffer = require('../SteppedBuffer')
const {NO_BLOCK, NO_BLOCK_AFTER, TAKE_BLOCKS_AFTER} = require('../Cmd')

module.exports = class TakeBlocksAfter extends Component {

  constructor({afterHash, blockCount, maxPacketSize, raw}) {
    super()
    this.module = 'TBA'
    
    this.packet = SteppedBuffer(256)
    this.zipped = !!raw
    if (raw) {
      this.packet.addBuffer(raw)
    } else {
      this.afterHash = afterHash
      this.maxBlockCount = Math.min(blockCount, 64)
      this.maxPacketSize = maxPacketSize
      
      const {packet} = this
      packet.addUInt(TAKE_BLOCKS_AFTER, 1)
      packet.addUInt(0x01, 1)
      packet.addBuffer(afterHash)
      packet.addUInt(0, 4) // afterId
      packet.addUInt(0, 2)
      this.blockCount = 0
    }
  }
  
  static create(data) {
    return new TakeBlocksAfter(data)
  }
  
  static fromRaw(raw) {
    return new TakeBlocksAfter({raw})
  }
  
  addBlock(hash, data) {
    this.blockCount++
    this.packet.seek(38)
    this.packet.addUInt(this.blockCount, 2)
    
    this.packet.tail()
    this.packet.addBuffer(hash)
    this.packet.addUInt(data.length, 4)
    this.packet.addBuffer(data)
  }
  
  addBlocks(callback) {
    const lockQueueLength = blockchain.getLockQueueLength()
    if (lockQueueLength > 2) {
      // this.log('{red-fg}Blocks request IGNORED (Queue: ' + lockQueueLength + '){/red-fg}')
      return
    }
    
    const blockCount = this.maxBlockCount
    blockchain.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by TakeBlocksAfter.addBlocks()')
      blockchain.getLength((blockchainLength) => {
        if (!blockchainLength) {
          unlock()
          callback(NO_BLOCK_AFTER)
          return
        }
        
        const readBlocksFrom = (id) => {
          blockchain.eachFromTo(id, id + blockCount, ({hash, data}, next) => {
            if (this.packet.getLength() + data.length > this.maxPacketSize) {
              next(false)
              return
            }
            
            this.addBlock(hash, data)
            next()
          }, () => {
            unlock()
            callback(TAKE_BLOCKS_AFTER)
          }, null, 1)
        }
        
        if (this.afterHash.equals(blockchain.getInitialPrevBlock())) {
          readBlocksFrom(0)
        } else {
          blockchain.getBlockIdByHash(this.afterHash, (id) => {
            if (id === -1) {
              unlock()
              callback(NO_BLOCK, {blockchainLength})
              return
            }
            
            if (id === blockchainLength - 1) {
              unlock()
              callback(NO_BLOCK_AFTER)
              return
            }
            
            readBlocksFrom(id + 1)
          }, 1)
        }
      }, 1)
    })
  }
  
  getInfo(callback) {
    if (this.packet.getLength() < 40) {
      callback(null)
      return
    }
    
    let data = {}
    const {packet} = this
    packet.seek(1)
    data.flags = packet.readUInt(1)
    if (!(data.flags & 0x01)) {
      callback(null)
      return
    }
    
    data.afterHash = packet.readBuffer(32)
    data.afterId = packet.readUInt(4)
    data.blockCount = packet.readUInt(2)
    if (!data.blockCount) {
      callback(null)
      return
    }
    
    callback(data)
  }
  
  eachBlock(callback, allowableLockCount = 0) {
    const {packet} = this
    
    if (packet.getLength() < 40) {
      callback(null)
      return
    }
    
    packet.seek(1)
    const flags = packet.readUInt(1)
    if (!(flags & 0x01)) {
      callback(null)
      return
    }
    
    packet.seek(38)
    const blockCount = packet.readUInt(2)
    
    const each = (data) => {
      let i = 0
      const next = () => {
         if (packet.untilEnd() < 36) {
          callback(null)
          return
        }
        
        const hash = packet.readBuffer(32)
        const dataLength = packet.readUInt(4)
        
        if (packet.untilEnd() < dataLength) {
          callback(null)
          return
        }
        
        // itemCallback(data, next)
        callback(Block.fromRaw(hash, packet.readBuffer(dataLength)), () => {
          if (++i < blockCount) {
            setImmediate(next)
          } else {
            callback(null)
          }
        })
      }
      next()
    }
    
    if (this.zipped) {
      zlib.inflateRaw(packet.readBufferUntilEnd(), (err, inflated) => {
        if (err) {
          callback(null)
        } else {
          this.zipped = false
          packet.seek(40)
          packet.addBuffer(inflated)
          packet.seek(40)
          each(inflated)
        }
      })
    } else {
      each(packet.readBufferUntilEnd())
    }
  }
  
  getRaw(callback) {
    if (this.zipped) {
      callback(this.packet.getWhole())
    } else {
      this.packet.seek(40)
      zlib.deflateRaw(this.packet.readBufferUntilEnd(), (err, deflated) => {
        this.zipped = true
        this.packet.seek(40)
        this.packet.addBuffer(deflated)
        this.packet.crop()
        callback(this.packet.getWhole())
      })
    }
  }
}