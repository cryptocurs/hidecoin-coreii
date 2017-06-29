'use strict'

module.exports = new class Buffers {

  // / 2
  shift(buffer) {
    let res = []
    let nextMask = 0x00
    for (let value of buffer) {
      res.push(value >> 1 | nextMask)
      nextMask = value & 0x01 ? 0x80 : 0x00
    }
    return Buffer.from(res)
  }
  
  // * 2
  unshift(buffer, addOne = false) {
    let res = []
    let prevMask = null
    let prevValue = null
    for (let value of buffer) {
      if (prevValue !== null) {
        res.push(prevValue << 1 | (value & 0x80 ? 0x01 : 0x00))
      }
      prevValue = value
    }
    res.push(prevValue << 1 | (addOne ? 0x01 : 0x00))
    return Buffer.from(res)
  }
}