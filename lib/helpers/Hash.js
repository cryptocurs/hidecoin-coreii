'use strict'

const crypto = require('crypto')

module.exports = new class Hash {

  once(data) {
    return crypto.createHash('sha256').update(data).digest()
  }
  
  twice(data) {
    return this.once(this.once(data))
  }
}