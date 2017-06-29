'use strict'

const crypto = require('crypto')
const eccrypto = require('eccrypto')
const bs58 = require('bs58')

const {ADDRESS_GROUP_ID} = require('./Constants')

const MIN_PRIVATE_KEY = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex')
const MAX_PRIVATE_KEY = Buffer.from('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140', 'hex')

module.exports = class Address {

  constructor(privateKey = null) {
    this.privateKey = privateKey
    this.publicKey = null
    this.addressRaw = null
    this.address = null
    
    this.prepareKeys = () => {
      if (this.address) {
        return false
      }
      this.publicKey = eccrypto.getPublic(this.privateKey)
      this.addressRaw = Address.publicKeyToAddress(this.publicKey)
      this.address = bs58.encode(this.addressRaw)
      
      return true
    }
  }
  
  static validatePrivateKey(privateKey) {
    let isValid = true

    if (privateKey.compare(MIN_PRIVATE_KEY) < 0) {
      isValid = false
    }
    if (privateKey.compare(MAX_PRIVATE_KEY) > 0) {
      isValid = false
    }

    return isValid
  }
  
  static publicKeyToAddress(publicKey) {
    let hash = crypto.createHash('sha256').update(publicKey).digest()
    hash = crypto.createHash('ripemd160').update(hash).digest()
    
    let checksum = Buffer.concat([ADDRESS_GROUP_ID, hash])
    checksum = crypto.createHash('sha256').update(checksum).digest()
    checksum = checksum.slice(0, 4)
    
    return Buffer.concat([ADDRESS_GROUP_ID, hash, checksum])
  }
  
  static hashToRaw(address) {
    return Buffer.from(bs58.decode(address))
  }
  
  static rawToHash(address) {
    return bs58.encode(address)
  }
  
  static isValid(address) {
    try {
      const decoded = address instanceof Buffer ? address : Buffer.from(bs58.decode(address))
      const basic = decoded.slice(0, 21)
      const checksum = decoded.slice(21)
      const basicChecksum = crypto.createHash('sha256').update(basic).digest().slice(0, 4)
      return (checksum.equals(basicChecksum))
    } catch(e) {
      return false
    }
  }
  
  static create() {
    let privateKey
    do {
      privateKey = crypto.randomBytes(32)
    } while (!Address.validatePrivateKey(privateKey))
    return new Address(privateKey)
  }
  
  static fromPrivateKey(privateKey) {
    return new Address(privateKey)
  }
  
  getKeys() {
    this.prepareKeys()
    return {
      priv: this.privateKey,
      publ: this.publicKey
    }
  }
  
  getRaw() {
    this.prepareKeys()
    return this.addressRaw
  }
  
  getHash() {
    this.prepareKeys()
    return this.address
  }
}