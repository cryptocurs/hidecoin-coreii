'use strict'

/*
*  TX_INFO                        from 33 bytes
*    buf(32)   hash
*    buf       data
*/

const Component = require('../Component')
const txProcessor = require('../TxProcessor')
const SteppedBuffer = require('../SteppedBuffer')
const {TX_INFO} = require('../Cmd')

module.exports = class TxInfo extends Component {

  constructor({hash, data, raw}) {
    super()
    this.module = 'TXI'
    
    this.data = {}
    this.errorWhileUnpacking = false
    
    this.packet = SteppedBuffer(256)
    if (raw) {
      if (raw.length < 53) {
        this.errorWhileUnpacking = true
        return
      }
      
      this.packet.addBuffer(raw)
      this.packet.seek(1)
      this.data.hash = this.packet.readBuffer(32)
    } else {
      this.data.hash = hash
      
      this.packet.addUInt(TX_INFO, 1)
      this.packet.addBuffer(hash)
      this.packet.addBuffer(data)
    }
  }
  
  static create(data) {
    return new TxInfo(data)
  }
  
  static fromRaw(raw) {
    return new TxInfo({raw})
  }
  
  process() {
    if (this.errorWhileUnpacking) {
      return
    }
    
    txProcessor.add(this.data.hash, this.packet.getSliced(33))
  }
  
  getRaw() {
    return this.packet.getWhole()
  }
}