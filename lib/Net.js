'use strict'

const R = require('ramda')
const _ = require('lodash')

const {Asyncs, Conv, Time} = require('./helpers')
const storage = require('./Storage')
const Component = require('./Component')
const p2x = require('./P2X')
const Cmd = require('./Cmd')
const SimpleCommand = require('./SimpleCommand')
const {TakeBlocksAfter, BlockFound, TxInfo} = require('./commands')

const RESPONSE_REQUEST_BLOCKS_AFTER = Cmd.REQUEST_BLOCKS_AFTER
const RESPONSE_INFO_REQUEST_BLOCKCHAIN_LENGTH = Cmd.INFO_REQUEST_BLOCKCHAIN_LENGTH
// don't use 0
const RESPONSE_NO_BLOCK = 1
const RESPONSE_NO_BLOCK_AFTER = 2

class Net extends Component {

  constructor() {
    super()
    this.module = 'NET'
    this.waiters = {}
    
    this.extractHashFromTakeBlocksAfter = (rawData) => {
      return rawData.slice(2, 34)
    }
    
    this.extractHashFromNoBlock = (rawData) => {
      return rawData.slice(1, 33)
    }
    
    this.isExpectedCommand = (rawData) => {
      const type = rawData[0]
      
      return (type !== Cmd.NO_BLOCK ||
        this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER] &&
        this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER].hash.equals(this.extractHashFromNoBlock(rawData))) &&
        (type !== Cmd.NO_BLOCK_AFTER ||
        this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER] &&
        this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER].hash.equals(this.extractHashFromNoBlock(rawData))) &&
        (type !== Cmd.TAKE_BLOCKS_AFTER ||
        this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER] &&
        this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER].hash.equals(this.extractHashFromTakeBlocksAfter(rawData))) &&
        (type !== Cmd.INFO_TAKE_BLOCKCHAIN_LENGTH ||
        this.waiters[RESPONSE_INFO_REQUEST_BLOCKCHAIN_LENGTH])
    }
    
    this.processCommand = (port, address, rawData, callback) => {
      const type = rawData[0]
      // this.log('Rcvd', Cmd.toStr(type), rawData.length, 'bytes from', address)
      
      if (!this.isExpectedCommand(rawData)) {
        callback && callback()
        return
      }
      
      if (type === Cmd.SRV_INFO && _.size(storage.servers) < 50) {
        const data = SimpleCommand.fromRaw(rawData).getData()
        if (data && !storage.servers[data.address]) {
          const {isIpv6, port, address} = data
          storage.servers[address] = {port, isIpv6}
          this.log('New node received:', address)
          this.broadcast(rawData)
        }
      } else if (type === Cmd.REQUEST_SRV_INFO) {
        const data = SimpleCommand.fromRaw(rawData).getData()
        if (data) {
          for (const serverAddress in storage.servers) {
            const server = storage.servers[serverAddress]
            this.sendSrvInfo(port, address, {
              port: server.serverPort,
              address: serverAddress,
              isIpv6: server.serverIsIpv6
            })
          }
        }
      } else if (type === Cmd.REQUEST_BLOCKS_AFTER) {
        const data = SimpleCommand.fromRaw(rawData).getData()
        if (data && data.flagZipped) {
          const takeBlocksAfter = TakeBlocksAfter.create({afterHash: data.hash, blockCount: data.count, maxPacketSize: p2x.getMaxMpxSize()})
          takeBlocksAfter.addBlocks((command, commandData) => {
            if (command === Cmd.NO_BLOCK) {
              const cmd = SimpleCommand.create(Cmd.NO_BLOCK, {hash: data.hash, blockchainLength: commandData.blockchainLength})
              this.send(port, address, cmd.getRaw())
            } else if (command === Cmd.NO_BLOCK_AFTER) {
              const cmd = SimpleCommand.create(Cmd.NO_BLOCK_AFTER, {hash: data.hash})
              this.send(port, address, cmd.getRaw())
            } else {
              takeBlocksAfter.getRaw((raw) => {
                this.send(port, address, raw)
              })
            }
          })
        }
      } else if (type === Cmd.NO_BLOCK) {
        const data = SimpleCommand.fromRaw(rawData).getData()
        data && this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER].callback(RESPONSE_NO_BLOCK, data)
      } else if (type === Cmd.NO_BLOCK_AFTER) {
        this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER].callback(RESPONSE_NO_BLOCK_AFTER)
      } else if (type === Cmd.TAKE_BLOCKS_AFTER) {
        const takeBlocksAfter = TakeBlocksAfter.fromRaw(rawData)
        this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER].callback(null, takeBlocksAfter)
      } else if (type === Cmd.BLOCK_FOUND) {
        const blockFound = BlockFound.fromRaw(rawData)
        blockFound.process()
      } else if (type === Cmd.TX_INFO) {
        const txInfo = TxInfo.fromRaw(rawData)
        txInfo.process()
      } else if (type === Cmd.INFO_REQUEST_BLOCKCHAIN_LENGTH) {
        const data = SimpleCommand.fromRaw(rawData).getData()
        data && this.sendInfoTakeBlockchainLength(port, address, {blockchainLength: storage.session.blockchain.length})
      } else if (type === Cmd.INFO_TAKE_BLOCKCHAIN_LENGTH) {
        const data = SimpleCommand.fromRaw(rawData).getData()
        data.address = address
        data && this.waiters[RESPONSE_INFO_REQUEST_BLOCKCHAIN_LENGTH].callback(null, data)
      }
      
      callback && callback()
    }
    
    this.send = (port, address, data, callbacks) => {
      p2x.send(port, address, data, callbacks)
      // this.log('Sent', Cmd.toStr(data[0]), 'to', address)
    }
    
    this.broadcast = (data, ignoreBroadcastLog = false, limit = null) => {
      if (!ignoreBroadcastLog) {
        if (!storage.session.netBroadcastLog) {
          storage.session.netBroadcastLog = {}
        }
        
        const localTime = Time.local() - 600
        for (const i in storage.session.broadcastLog) {
          if (storage.session.netBroadcastLog[i] < localTime) {
            delete storage.session.netBroadcastLog[i]
          }
        }
        
        const dataBased = Conv.bufToBase(data.slice(0, 256))
        if (storage.session.netBroadcastLog[dataBased]) {
          return false
        }
        storage.session.netBroadcastLog[dataBased] = localTime
      }
      
      let startIn = 0
      let requested = 0
      
      Asyncs.forEach(storage.servers, (server, address, next) => {
        if (!server) {
          next()
          return
        }
        
        requested++
        this.send(server.port, address, data, {
          onTimeout: () => {
            next()
          }
        })
        
        if (!limit || requested < limit) {
          next()
        }
      })
      
      return true
    }
    
    p2x.on('online', () => {
      this.broadcastRequestSrvInfo()
    })
    
    p2x.on('newServer', (port, address, isIpv6) => {
      this.broadcastSrvInfo({
        port,
        address,
        isIpv6
      })
    })
    
    p2x.on('rcvdData', (port, address, data) => {
      this.processCommand(port, address, data)
    })
    
    p2x.on('mpxRcvdFirst', (mpxIdStr, data, processing, processed) => {
      processing()
      processed(this.isExpectedCommand(data))
    })
    
    p2x.on('mpxAborted', (mpxIdStr) => {
      
    })
    
    p2x.on('mpxRcvdFully', (mpxIdStr, port, address, data, processing, processed) => {
      processing()
      this.processCommand(port, address, data, () => {
        processed()
      })
    })
  }
  
  sendSrvInfo(port, address, data, callbacks) {
    const cmd = SimpleCommand.create(Cmd.SRV_INFO, data)
    this.send(port, address, cmd.getRaw())
  }
  
  sendInfoTakeBlockchainLength(port, address, data) {
    const cmd = SimpleCommand.create(Cmd.INFO_TAKE_BLOCKCHAIN_LENGTH, data)
    this.send(port, address, cmd.getRaw())
  }
  
  sendNoBlock(port, address, data) {
    const cmd = SimpleCommand.create(Cmd.NO_BLOCK, data)
    this.send(port, address, cmd.getRaw())
  }
  
  sendNoBlockAfter(port, address, data) {
    const cmd = SimpleCommand.create(Cmd.NO_BLOCK_AFTER, data)
    this.send(port, address, cmd.getRaw())
  }
  
  broadcastSrvInfo(data) {
    const cmd = SimpleCommand.create(Cmd.SRV_INFO, data)
    this.broadcast(cmd.getRaw())
  }
  
  broadcastRequestSrvInfo() {
    const cmd = SimpleCommand.create(Cmd.REQUEST_SRV_INFO)
    this.broadcast(cmd.getRaw())
  }
  
  broadcastRequestBlocksAfter(hash, count = 64, id = 0) {
    const cmd = SimpleCommand.create(Cmd.REQUEST_BLOCKS_AFTER, {hash, count, id})
    this.broadcast(cmd.getRaw(), true, 10)
  }
  
  broadcastBlockFound(hash, data) {
    const blockFound = BlockFound.create({hash, data})
    this.broadcast(blockFound.getRaw())
  }
  
  broadcastTxInfo(hash, data) {
    const txInfo = TxInfo.create({hash, data})
    this.broadcast(txInfo.getRaw())
  }
  
  broadcastInfoRequestBlockchainLength() {
    const cmd = SimpleCommand.create(Cmd.INFO_REQUEST_BLOCKCHAIN_LENGTH)
    this.broadcast(cmd.getRaw(), true)
  }
  
  requestBlocksAfter(hash, count = 64, responseCallback, finishedCallback) {
    this.broadcastRequestBlocksAfter(hash, count)
    if (this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER]) {
      clearInterval(this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER].timer)
    }
    this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER] = {
      hash,
      timer: setInterval(() => {
        if (!p2x.getMpxsCountByCmdStr('TAKE_BLOCKS_AFTER')) {
          clearInterval(this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER].timer)
          finishedCallback && finishedCallback()
          this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER] = null
        }
      }, 2000),
      callback: responseCallback
    }
  }
  
  clearRequestBlocksAfter() {
    if (this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER]) {
      clearTimeout(this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER].timer)
      this.waiters[RESPONSE_REQUEST_BLOCKS_AFTER] = null
      p2x.abortMpxsByCmdStr('TAKE_BLOCKS_AFTER')
    }
  }
  
  requestBlockchainLength(responseCallback, finishedCallback) {
    this.broadcastInfoRequestBlockchainLength()
    if (this.waiters[RESPONSE_INFO_REQUEST_BLOCKCHAIN_LENGTH]) {
      clearTimeout(this.waiters[RESPONSE_INFO_REQUEST_BLOCKCHAIN_LENGTH].timer)
    }
    this.waiters[RESPONSE_INFO_REQUEST_BLOCKCHAIN_LENGTH] = {
      timer: setTimeout(() => {
        finishedCallback && finishedCallback()
        this.waiters[RESPONSE_INFO_REQUEST_BLOCKCHAIN_LENGTH] = null
      }, 2000),
      callback: responseCallback
    }
  }
  
  getConstants() {
    return {
      RESPONSE_NO_BLOCK: RESPONSE_NO_BLOCK,
      RESPONSE_NO_BLOCK_AFTER: RESPONSE_NO_BLOCK_AFTER
    }
  }
}

const net = new Net
module.exports = net