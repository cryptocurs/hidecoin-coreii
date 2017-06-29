'use strict'

const crypto = require('crypto')

module.exports = new class Defended {

  encrypt(text, password) {
    const cipher = crypto.createCipher('aes192', password)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return encrypted
  }
  
  decrypt(text, password) {
    const decipher = crypto.createDecipher('aes192', password)
    let decrypted
    try {
      decrypted = decipher.update(text, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
    } catch (e) {
      return false
    }
    return decrypted
  }
}