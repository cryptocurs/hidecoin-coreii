'use strict'

const eccrypto = require('eccrypto')

const Hash = require('./Hash')

module.exports = new class Sign {

  make(data, privateKey, callback) {
    const textHash = Hash.once(data)
    eccrypto.sign(privateKey, textHash).then((sign) => {
      callback && callback(sign)
    }).catch((e) => {
      console.log(e)
    })
  }
  
  verify(data, publicKey, sign, callback) {
    const textHash = Hash.once(data)
    eccrypto.verify(publicKey, textHash, sign).then(() => {
      callback && callback(true)
    }).catch(() => {
      callback && callback(false)
    })
  }
}