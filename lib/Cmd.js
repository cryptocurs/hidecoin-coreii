'use strict'

const commands = {
  SRV_INFO: 0x10, // processed
  REQUEST_SRV_INFO: 0x11, // processed
  REQUEST_BLOCKS_AFTER: 0x23, // processed
  NO_BLOCK: 0x31, // processed
  NO_BLOCK_AFTER: 0x32, // processed
  TAKE_BLOCKS_AFTER: 0x33, // processed
  BLOCK_FOUND: 0x40, // processed
  BLOCK_FOUND_ZIPPED: 0x41, // processed
  TX_INFO: 0x50, // processed
  TX_INFO_ZIPPED: 0x51, // processed
  INFO_REQUEST_BLOCKCHAIN_LENGTH: 0x80, // processed
  INFO_TAKE_BLOCKCHAIN_LENGTH: 0x90, // processed
  ANY: 0xff
}

module.exports = commands
module.exports.toStr = (type) => {
  switch (type) {
    case commands.SRV_INFO: return 'SRV_INFO'
    case commands.REQUEST_SRV_INFO: return 'REQUEST_SRV_INFO'
    case commands.REQUEST_BLOCKS_AFTER: return 'REQUEST_BLOCKS_AFTER'
    case commands.NO_BLOCK: return 'NO_BLOCK'
    case commands.NO_BLOCK_AFTER: return 'NO_BLOCK_AFTER'
    case commands.TAKE_BLOCKS_AFTER: return 'TAKE_BLOCKS_AFTER'
    case commands.BLOCK_FOUND: return 'BLOCK_FOUND'
    case commands.BLOCK_FOUND_ZIPPED: return 'BLOCK_FOUND_ZIPPED'
    case commands.TX_INFO: return 'TX_INFO'
    case commands.TX_INFO_ZIPPED: return 'TX_INFO_ZIPPED'
    case commands.INFO_REQUEST_BLOCKCHAIN_LENGTH: return 'INFO_REQUEST_BLOCKCHAIN_LENGTH'
    case commands.INFO_TAKE_BLOCKCHAIN_LENGTH: return 'INFO_TAKE_BLOCKCHAIN_LENGTH'
    default: return 'UNKNOWN'
  }
}