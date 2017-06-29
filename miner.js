'use strict'

const {Conv, Hash, Time} = require('./lib/helpers')
const moment = require('moment')
const {Client} = require('json-rpc2')

console.log('Miner for Hidecoin Core II')

const log = (...data) => {
  console.log('[' + moment().format('HH:mm:ss') + ']#', ...data)
}

var hashesPerCycle = 100000
var nonce = 0
var working = false

const args = process.argv
for (let i = 2; i < args.length; i++) {
  if ((args[i] === '--hpc') && (args[i + 1] !== undefined)) {
    hashesPerCycle = args[i + 1]
  } else if ((args[i] === '--nonce') && (args[i + 1] !== undefined)) {
    const buffer = Buffer.alloc(8, 0x00)
    let argNonce = args[i + 1]
    if (argNonce.length % 2) {
      argNonce = '0' + argNonce
    }
    const nonceBuffer = Buffer.from(argNonce, 'hex')
    nonceBuffer.copy(buffer, 8 - nonceBuffer.length)
    nonce = Packet(buffer).unpackNumber64()
  }
}

const initNonce = nonce
var hps = 0

log('Configuration')
log('HPC     :', hashesPerCycle)
log('Nonce   :', nonce)

const client = Client.$create(5839, 'localhost')
const continueMining = () => {
  if (working) {
    log('Already mining')
    return
  }
  working = true
  log('Requesting fresh data')
  client.call('miner.gettask', {nonce: initNonce, hps}, (err, res) => {
    if (err) {
      log('Error:', err)
    }
    if (!res) {
      log('Request error')
      setTimeout(continueMining, 1000)
      working = false
      return
    }
    
    if (!res.active) {
      log('Mining suspended')
      hps = 0
      working = false
      setTimeout(continueMining, 1000)
      return
    }
    
    const blockData = Conv.baseToBuf(res.blockData)
    const header = blockData.slice(0, res.blockHeaderSize)
    const diff = blockData.slice(41, 73)
    
    log('Received fresh data, block size', blockData.length, 'bytes')
    
    let hash
    const timeStart = Time.localMs()
    for (let i = 0; i < hashesPerCycle; i++) {
      nonce = (nonce < 0xffffffffffff0000 ? nonce + 1 : 0)
      blockData.writeUIntBE(nonce, 73, 8)
      hash = Hash.twice(header)
      if (hash.compare(diff) <= 0) {
        log('FOUND', Conv.bufToHex(hash))
        client.call('miner.blockfound', {hash: Conv.bufToBase(hash), blockData: Conv.bufToBase(blockData), txHashList: res.txHashList}, (err, res) => {
          res && res.status && log(res.status)
        })
        setTimeout(continueMining, 500)
        working = false
        return
      }
    }
    
    const duration = Time.localMs() - timeStart
    hps = parseInt(hashesPerCycle * 1000 / duration)
    log('HPS', hps, 'Diff', Conv.bufToHex(diff))
    
    working = false
    continueMining()
  })
}

continueMining()