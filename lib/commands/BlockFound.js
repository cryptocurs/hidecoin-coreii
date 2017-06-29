'use strict'

/*
*  BLOCK_FOUND                    from 33 bytes
*    buf(32)   hash
*    buf       data
*/

const Component = require('../Component')
const blockProcessor = require('../BlockProcessor')
const SteppedBuffer = require('../SteppedBuffer')
const {BLOCK_FOUND} = require('../Cmd')

module.exports = class BlockFound extends Component {

  constructor({hash, data, raw}) {
    super()
    this.module = 'BFN'
    
    this.data = {}
    this.errorWhileUnpacking = false
    
    this.packet = SteppedBuffer(256)
    if (raw) {
      if (raw.length < 118) {
        this.errorWhileUnpacking = true
        return
      }
      
      this.packet.addBuffer(raw)
      this.packet.seek(1)
      this.data.hash = this.packet.readBuffer(32)
    } else {
      this.data.hash = hash
      
      this.packet.addUInt(BLOCK_FOUND, 1)
      this.packet.addBuffer(hash)
      this.packet.addBuffer(data)
    }
  }
  
  static create(data) {
    return new BlockFound(data)
  }
  
  static fromRaw(raw) {
    return new BlockFound({raw})
  }
  
  process() {
    if (this.errorWhileUnpacking) {
      return
    }
    
    blockProcessor.add(this.data.hash, this.packet.getSliced(33))
  }
  
  getRaw() {
    return this.packet.getWhole()
  }
}