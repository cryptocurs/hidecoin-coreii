'use strict'

/*
*  BLOCK_FOUND_ZIPPED             from 33 bytes
*    buf(32)   hash
*    buf       zlib(data)
*/

const zlib = require('zlib')

const Component = require('../Component')
const txProcessor = require('../TxProcessor')
const SteppedBuffer = require('../SteppedBuffer')
const {TX_INFO_ZIPPED} = require('../Cmd')

module.exports = class TxInfoZipped extends Component {

  constructor({hash, data, raw}) {
    super()
    this.module = 'TXZ'
    
    this.data = {}
    this.errorWhileUnpacking = false
    
    this.packet = SteppedBuffer(256)
    if (raw) {
      if (raw.length < 33) {
        this.errorWhileUnpacking = true
        return
      }
      
      this.packet.addBuffer(raw)
      this.packet.seek(1)
      this.data.hash = this.packet.readBuffer(32)
      
      this.lock()
      zlib.inflateRaw(this.packet.readBufferUntilEnd(), (err, inflated) => {
        if (err) {
          storage.emit('fatalError', 'zlib error')
          return
        }
        
        this.packet.seek(33)
        this.packet.addBuffer(inflated)
        this.packet.crop()
        this.unlock()
      })
    } else {
      this.data.hash = hash
      
      this.packet.addUInt(TX_INFO_ZIPPED, 1)
      this.packet.addBuffer(hash)
      this.packet.addBuffer(data)
      
      this.packet.seek(33)
      this.lock()
      zlib.deflateRaw(this.packet.readBufferUntilEnd(), (err, deflated) => {
        if (err) {
          storage.emit('fatalError', 'zlib error')
          return
        }
        
        this.packet.seek(33)
        this.packet.addBuffer(deflated)
        this.packet.crop()
        this.unlock()
      })
    }
  }
  
  static create(data) {
    return new TxInfoZipped(data)
  }
  
  static fromRaw(raw) {
    return new TxInfoZipped({raw})
  }
  
  process() {
    if (this.errorWhileUnpacking) {
      return
    }
    
    this.whenUnlocked((unlock) => {
      unlock()
      txProcessor.add(this.data.hash, this.packet.getSliced(33))
    })
  }
  
  getRaw(callback) {
    this.whenUnlocked((unlock) => {
      unlock()
      callback(this.packet.getWhole())
    })
  }
}