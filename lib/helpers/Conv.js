'use strict'

const _ = require('lodash')

module.exports = new class Conv {

  objToJson(data) {
    return JSON.stringify(data)
  }
  
  jsonToObj(data) {
    return JSON.parse(data)
  }
  
  strToBase(text) {
    return Buffer.from(text).toString('base64')
  }
  
  baseToStr(text) {
    return Buffer.from(text, 'base64').toString()
  }
  
  bufToBase(buffer) {
    return buffer.toString('base64')
  }
  
  baseToBuf(base) {
    return Buffer.from(base, 'base64')
  }
  
  bufToHex(buf) {
    return buf.toString('hex')
  }
  
  hexToBuf(hex) {
    return Buffer.from(hex, 'hex')
  }
  
  bufToHexBytes(buf) {
    let str = '<Buffer '
    for (const Byte of buf) {
      str += _.padStart(Byte.toString(16), 2, '0') + ' '
    }
    str += '>'
    return str
  }
  
  countToStr(size) {
    if (size < 1000) {
      return size
    } else if (size < 1000000) {
      return (size / 1000 >> 0) + 'K'
    } else {
      return (size / 1000000 >> 0) + 'M'
    }
  }
  
  sizeToStr(size) {
    if (size < 1024) {
      return size + ' B'
    } else if (size < 1048576) {
      return (size / 1024 >> 0) + ' KB'
    } else {
      return (size / 1048576 >> 0) + ' MB'
    }
  }
}