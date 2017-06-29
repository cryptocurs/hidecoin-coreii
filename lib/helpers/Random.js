'use strict'

const crypto = require('crypto')

module.exports = new class Sign {

  bool() {
    return (Math.random() < 0.5)
  }
  
  number(min, max) {
    return min + Math.floor(Math.random() * (max + 1 - min))
  }
  
  item(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
  }
  
  bytes(bytesCount) {
    return crypto.randomBytes(bytesCount)
  }
}