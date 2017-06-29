'use strict'

/* Work with commands
*  Commands format
*  First byte - command type
*
*  SRV_INFO                       7 or 19 bytes
*    int(2)    port
*    buf(4)    IPv4    OR    buf(16)    IPv6
*  REQUEST_SRV_INFO               1 byte
*    <empty>
*  REQUEST_BLOCKS_AFTER           40 bytes
*    int(1)    flags:
*      FLAG_ZIP_ALLOWED 0x01
*    buf(32)   hash
*    int(4)    id
*    int(2)    count
*  NO_BLOCK                       69 bytes
*    buf(32)   hash
*    int(4)    blockchainLength
*    buf(32)   lastBlockHash      DEPRECATED
*  NO_BLOCK_AFTER                 33 bytes
*    buf(32)   hash
* #TAKE_BLOCKS_AFTER              from 40 bytes
*    int(1)    flags:
*      FLAG_ZIPPED 0x01
*    buf(32)   afterHash
*    int(4)    afterId            DEPRECATED
*    int(2)    blockCount
*    BLOCKS
*      buf(32)   hash
*      int(4)    dataLength
*      buf       data
*    if FLAG_ZIPPED then
*      zlib(BLOCKS)
* #BLOCK_FOUND                    from 33 bytes
*    buf(32)   hash
*    buf       data
* #TX_INFO                        from 33 bytes
*    buf(32)   hash
*    buf       data
*  INFO_REQUEST_BLOCKCHAIN_LENGTH 1 byte
*    <empty>
*  INFO_TAKE_BLOCKCHAIN_LENGTH    5 bytes
*    int(4)    blockchainLength
*
*  # - not simple command
*/

const {IP} = require('./helpers')
const SteppedBuffer = require('./SteppedBuffer')
const Cmd = require('./Cmd')

const DEFAULT_LAST_BLOCK_HASH = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex')

const initialSizes = {
  [Cmd.SRV_INFO]: 7,
  [Cmd.REQUEST_SRV_INFO]: 1,
  [Cmd.REQUEST_BLOCKS_AFTER]: 40,
  [Cmd.NO_BLOCK]: 69,
  [Cmd.NO_BLOCK_AFTER]: 33,
  [Cmd.TAKE_BLOCKS_AFTER]: 40,
  [Cmd.BLOCK_FOUND]: 33,
  [Cmd.TX_INFO]: 33,
  [Cmd.INFO_REQUEST_BLOCKCHAIN_LENGTH]: 1,
  [Cmd.INFO_TAKE_BLOCKCHAIN_LENGTH]: 5
}

module.exports = class SimpleCommand {

  constructor({type, data, raw}) {
    if (type) {
      this.data = data || {}
      this.packet = SteppedBuffer(initialSizes[type])
      const {packet} = this
      packet.addUInt(type, 1)
      
      if (type === Cmd.SRV_INFO) {
        packet.addUInt(data.port, 2)
        packet.addBuffer(data.isIpv6 ? IP.v6Pack(data.address) : IP.v4Pack(data.address))
      } else if (type === Cmd.REQUEST_BLOCKS_AFTER) {
        packet.addUInt(0x01, 1)
        packet.addBuffer(data.hash)
        packet.addUInt(data.id, 4)
        packet.addUInt(data.count, 2)
      } else if (type === Cmd.REQUEST_HASHES_AFTER) {
        packet.addBuffer(data.hash)
      } else if (type === Cmd.NO_BLOCK) {
        packet.addBuffer(data.hash)
        packet.addUInt(data.blockchainLength, 4)
        packet.addBuffer(DEFAULT_LAST_BLOCK_HASH)
      } else if (type === Cmd.NO_BLOCK_AFTER) {
        packet.addBuffer(data.hash)
      } else if (type === Cmd.INFO_TAKE_BLOCKCHAIN_LENGTH) {
        packet.addUInt(data.blockchainLength, 4)
      }
    } else {
      this.data = {}
      this.packet = SteppedBuffer(64)
      const {packet} = this
      const length = raw.length
      packet.addBuffer(raw)
      packet.seek(0)
      const type = packet.readUInt(1)
      
      if (type === Cmd.SRV_INFO) {
        if (length !== 7 && length !== 19) {
          this.data = null
          return
        }
        
        this.data.isIpv6 = packet.getLength() === 19
        this.data.port = packet.readUInt(2)
        if (!this.data.port) {
          this.data = null
          return
        }
        
        const addressRaw = packet.readBufferUntilEnd()
        this.data.address = this.data.isIpv6 ? IP.v6Unpack(addressRaw) : IP.v4Unpack(addressRaw)
      } else if (type === Cmd.REQUEST_SRV_INFO) {
        if (length !== 1) {
          this.data = null
          return
        }
      } else if (type === Cmd.REQUEST_BLOCKS_AFTER) {
        if (length !== 40) {
          this.data = null
          return
        }
        
        this.data.flags = packet.readUInt(1)
        this.data.flagZipped = this.data.flags & 0x01
        this.data.hash = packet.readBuffer(32)
        this.data.id = packet.readUInt(4)
        this.data.count = packet.readUInt(2)
        if (!this.data.count) {
          this.data = null
          return
        }
      } else if (type === Cmd.NO_BLOCK) {
        if (length !== 69) {
          this.data = null
          return
        }
        
        this.data.hash = packet.readBuffer(32)
        this.data.blockchainLength = packet.readUInt(4)
        this.data.lastBlockHash = packet.readBuffer(32)
      } else if (type === Cmd.NO_BLOCK_AFTER) {
        if (length !== 33) {
          this.data = null
          return
        }
        
        this.data.hash = packet.readBuffer(32)
      } else if (type === Cmd.INFO_REQUEST_BLOCKCHAIN_LENGTH) {
        if (length !== 1) {
          this.data = null
          return
        }
      } else if (type === Cmd.INFO_TAKE_BLOCKCHAIN_LENGTH) {
        if (length !== 5) {
          this.data = null
          return
        }
        
        this.data.blockchainLength = packet.readUInt(4)
      } else {
        this.data = null
      }
    }
  }
  
  static create(type, data = {}) {
    return new SimpleCommand({type, data})
  }
  
  static fromRaw(raw) {
    return new SimpleCommand({raw})
  }
  
  getData() {
    return this.data
  }
  
  getRaw() {
    return this.packet.getWhole()
  }
}