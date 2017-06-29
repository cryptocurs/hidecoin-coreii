'use strict'

const dgram = require('dgram')
const R = require('ramda')
const _ = require('lodash')

const Component = require('./Component')
const {Conv, Random, Time} = require('./helpers')
const disp = require('./Disp')
const storage = require('./Storage')
const SteppedBuffer = require('./SteppedBuffer')

const TIMEOUT = 2000
const ATTEMPTS = 5
const DEBUG_CLIENT_MODE = false

const PACK_PING = 0x00
const PACK_PONG = 0x01
const PACK_CONNECT = 0x04
const PACK_EXT_IP_OK = 0x05
const PACK_KEEP_ALIVE = 0x06
const PACK_ERR_NET_LOOP = 0x07
const PACK_DATA = 0x08
const PACK_DATA_OK = 0x09
const PACK_DATA_PART = 0x0a
const PACK_DATA_PART_OK = 0x0b
const PACK_DATA_PART_SIZE = 0x0c
const PACK_DATA_PART_SIZE_OK = 0x0d
const PACK_CONNECT_CLIENT = 0x0e
const PACK_DATA_PART_REJECT = 0x0f
const PACK_ANY = 0xff

const CMD_PING = Buffer.from([PACK_PING])
const CMD_PONG = Buffer.from([PACK_PONG])
const CMD_ERR_NET_LOOP = Buffer.from([PACK_ERR_NET_LOOP])

class P2P extends Component {

  constructor() {
    super()
    this.module = 'P2P'
    this.sockets = {client: null, server: null}
    this.uniqueId = Random.bytes(8)
    this.serverPort = null
    this.clientPort = null
    this.serverOnline = false
    this.clientOnline = false
    this.serverModeAttempts = 0
    this.waiters = {}
    this.lockMessages = false
    
    this.closeClient = () => {
      if (!this.sockets.client) {
        return false
      }
      this.sockets.client.close()
      this.sockets.client.removeAllListeners()
      this.sockets.client = null
    }
    
    this.closeServer = () => {
      if (!this.sockets.server) {
        return false
      }
      this.sockets.server.close()
      this.sockets.server.removeAllListeners()
      this.sockets.server = null
    }
    
    this.bindLocalPort = () => {
      const port = Random.number(50000, 55000)
      this.closeClient()
      this.sockets.client = dgram.createSocket('udp4')
      this.sockets.client.on('error', () => {
        this.bindLocalPort()
      })
      this.sockets.client.on('message', (...data) => {
        this.clientProcessMessage(...data)
      })
      this.sockets.client.bind(port)
      this.clientPort = port
    }
    
    this.validateLength = (msg) => {
      const type = msg[0]
      return msg.length && (R.contains(type,
        [PACK_PING, PACK_PONG, PACK_EXT_IP_OK, PACK_KEEP_ALIVE, PACK_ERR_NET_LOOP]) && (msg.length === 1)
        || R.contains(type, [PACK_CONNECT, PACK_CONNECT_CLIENT]) && (msg.length === 11)
        || (type === PACK_DATA) && (msg.length >= 13)
        || (type === PACK_DATA_OK) && (msg.length === 5)
        || (type === PACK_DATA_PART) && (msg.length >= 17)
        || (type === PACK_DATA_PART_OK) && (msg.length === 9)
        || (type === PACK_DATA_PART_SIZE) && (msg.length === 21)
        || (type === PACK_DATA_PART_SIZE_OK) && (msg.length === 13)
        || (type === PACK_DATA_PART_REJECT) && (msg.length === 5))
    }
    
    this.deleteServer = (address) => {
      if (storage.servers[address] && !storage.servers[address].prime) {
        delete storage.servers[address]
        this.log('Deleted node', address)
      }
    }
    
    this.processMessage = (msg, rinfo) => {
      const {port, address} = rinfo
      const type = msg[0]
      
      const isNetLoop = () => {
        if (msg.slice(1, 9).equals(this.uniqueId)) {
          this.errNetLoop(port, address)
          return true
        } else {
          return false
        }
      }
      
      if (storage.session.stat) {
        storage.session.stat.rps++
      }
      
      let waiterId = PACK_ANY + ':' + address + ':' + port
      if (this.waiters[waiterId]) {
        for (const subId in this.waiters[waiterId]) {
          this.waiters[waiterId][subId].onRcvd && this.waiters[waiterId][subId].onRcvd(msg)
        }
      }
      
      waiterId = type + ':' + address + ':' + port
      if (this.waiters[waiterId]) {
        for (const subId in this.waiters[waiterId]) {
          this.waiters[waiterId][subId].onRcvd && this.waiters[waiterId][subId].onRcvd(msg)
        }
      }
      
      if (type === PACK_PING) {
        this.send(port, address, CMD_PONG)
      } else if (type === PACK_CONNECT) {
        if (isNetLoop()) {
          return
        }
        
        if (!storage.servers[address]) {
          this.log('Checking node', address)
          const port = msg.readUInt16BE(9)
          this.ping(port, address, {
            onPong: () => {
              storage.servers[address] = {port, isIpv6: false}
              this.emit('newServer', port, address, false)
              this.log('New node connected:', port, address)
            }
          })
        }
      } else if (type === PACK_ERR_NET_LOOP) {
        this.deleteServer(address)
      } else if (type === PACK_DATA) {
        if (isNetLoop()) {
          return
        }
        
        this.dataOk(port, address, msg.slice(9, 13))
        this.emit('rcvdData', port, address, msg.slice(13))
      } else if (type === PACK_DATA_PART) {
        this.emit('rcvdDataPart', port, address, msg, (accepted) => {
          if (accepted) {
            this.dataPartOk(port, address, msg.slice(9, 17))
          } else {
            this.dataPartReject(port, address, msg.slice(9, 13))
          }
        })
      } else if (type === PACK_DATA_PART_SIZE) {
        if (isNetLoop()) {
          return
        }
        this.emit('rcvdDataPartSize', port, address, msg, (accepted) => {
          if (accepted) {
            this.dataPartSizeOk(port, address, msg.slice(9, 21))
          } else {
            this.dataPartReject(port, address, msg.slice(9, 13))
          }
        })
      }
    }
    
    this.clientProcessMessage = (msg, rinfo) => {
      if (this.lockMessages) {
        return
      }
      
      this.log('RCVD C', rinfo.address, Conv.bufToHex(msg))
      this.processMessage(msg, rinfo)
    }
    
    this.serverProcessMessage = (msg, rinfo) => {
      if (this.lockMessages) {
        return
      }
      
      this.log('RCVD S', rinfo.address, Conv.bufToHex(msg))
      if (!this.serverOnline) {
        this.serverOnline = true
        this.closeClient()
        this.emit('serverMode')
        this.emit('online')
        this.onServerOnline()
      }
      this.processMessage(msg, rinfo)
    }
    
    this.onServerOnline = () => {
      Time.doNowAndSetInterval(() => {
        for (const address in storage.servers) {
          const {port} = storage.servers[address]
          this.connect(port, address)
        }
      }, 120000)
    }
    
    this.bindLocalPort()
    
    disp.on('sigTerm', () => {
      this.lockMessages = true
    })
  }
  
  listen(serverPort, callback) {
    if (!this.serverPort) {
      if (DEBUG_CLIENT_MODE) {
        callback && callback()
      } else {
        this.serverPort = serverPort
        this.sockets.server = dgram.createSocket('udp4')
        this.sockets.server.on('error', () => {
          storage.emit('fatalError', 'Server socket error')
        })
        this.sockets.server.on('message', (...data) => {
          this.serverProcessMessage(...data)
        })
        this.sockets.server.bind(serverPort, callback)
      }
    }
  }
  
  send(port, address, msg, useClientSocket = false) {
    if (this.lockMessages) {
      return
    }
    
    let socket
    let mode
    if (this.clientMode || useClientSocket) {
      socket = this.sockets.client
      mode = 'C'
    } else {
      socket = this.sockets.server
      mode = 'S'
    }
    socket && socket.send(msg, port, address, (err) => {
      if (err) {
        this.emit('error', err)
      } else {
        this.log('SENT', mode, address, Conv.bufToHex(msg))
      }
    })
  }
  
  wait(port, address, type, timeout, callbacks) {
    const multi = type instanceof Array
    const waiterId = (multi ? PACK_ANY : type) + ':' + address + ':' + port
    let subId = 0
    if (this.waiters[waiterId]) {
      while (this.waiters[waiterId][subId]) {
        subId++
      }
    } else {
      this.waiters[waiterId] = {}
    }
    const timer = setTimeout(() => {
      delete this.waiters[waiterId][subId]
      if (!_.size(this.waiters[waiterId])) {
        delete this.waiters[waiterId]
      }
      callbacks.onTimeout && callbacks.onTimeout()
    }, timeout)
    this.waiters[waiterId][subId] = {
      onRcvd: (msg) => {
        if ((!multi || R.contains(msg[0], type)) && (!callbacks.onRcvd || (callbacks.onRcvd(msg) !== false))) {
          clearTimeout(timer)
          delete this.waiters[waiterId][subId]
          if (!_.size(this.waiters[waiterId])) {
            delete this.waiters[waiterId]
          }
        }
      },
      close: () => {
        clearTimeout(timer)
        delete this.waiters[waiterId][subId]
        if (!_.size(this.waiters[waiterId])) {
          delete this.waiters[waiterId]
        }
      }
    }
  }
  
  sendWait(port, address, msg, waitFor, callbacks = {}, timeout = TIMEOUT, attempts = ATTEMPTS) {
    this.send(port, address, msg)
    this.wait(port, address, waitFor, timeout, {
      onRcvd: (msg) => {
        if (callbacks.onRcvd) {
          return callbacks.onRcvd(msg)
        }
      },
      onTimeout: () => {
        if (attempts > 1) {
          this.sendWait(port, address, msg, waitFor, callbacks, timeout, attempts - 1)
        } else {
          callbacks.onTimeout && callbacks.onTimeout()
        }
      }
    })
  }
  
  ping(port, address, callbacks) {
    this.sendWait(port, address, CMD_PING, PACK_PONG, {
      onRcvd: () => {
        callbacks && callbacks.onPong && callbacks.onPong()
      },
      onTimeout: () => {
        this.deleteServer(address)
        callbacks && callbacks.onTimeout && callbacks.onTimeout()
      }
    })
  }
  
  connect(port, address) {
    const packet = SteppedBuffer(11)
    packet.addUInt(PACK_CONNECT, 1)
    packet.addBuffer(this.uniqueId)
    packet.addUInt(this.serverPort, 2)
    this.send(port, address, packet.getWhole())
  }
  
  errNetLoop(port, address) {
    this.send(port, address, CMD_ERR_NET_LOOP)
  }
  
  data(port, address, msg, callbacks) {
    const reqId = Random.bytes(4)
    
    const packet = SteppedBuffer(64)
    packet.addUInt(PACK_DATA, 1)
    packet.addBuffer(this.uniqueId)
    packet.addBuffer(reqId)
    packet.addBuffer(msg)
    this.sendWait(port, address, packet.getWhole(), [PACK_DATA_OK, PACK_ERR_NET_LOOP], {
      onRcvd: (msg) => {
        if (msg[0] === PACK_DATA_OK) {
          if (msg.slice(1, 5).equals(reqId)) {
            callbacks && callbacks.onAccepted && callbacks.onAccepted()
          } else {
            return false
          }
        } else {
          callbacks && callbacks.onRejected && callbacks.onRejected()
        }
      },
      onTimeout: () => {
        callbacks && callbacks.onTimeout && callbacks.onTimeout()
      }
    })
  }
  
  dataOk(port, address, reqId) {
    const packet = SteppedBuffer(5)
    packet.addUInt(PACK_DATA_OK, 1)
    packet.addBuffer(reqId)
    this.send(port, address, packet.getWhole())
  }
  
  dataPart(port, address, mpxId, partId, msg, callbacks) {
    const packet = SteppedBuffer(64)
    packet.addUInt(PACK_DATA_PART, 1)
    packet.addBuffer(this.uniqueId)
    packet.addBuffer(mpxId)
    packet.addUInt(partId, 4)
    packet.addBuffer(msg)
    this.sendWait(port, address, packet.getWhole(), [PACK_DATA_PART_OK, PACK_DATA_PART_REJECT], {
      onRcvd: (msg) => {
        if (msg[0] === PACK_DATA_PART_OK) {
          if (msg.slice(1, 5).equals(mpxId) && msg.readUInt32BE(5) === partId) {
            callbacks && callbacks.onAccepted && callbacks.onAccepted()
          } else {
            return false
          }
        } else {
          callbacks && callbacks.onRejected && callbacks.onRejected()
        }
      },
      onTimeout: () => {
        callbacks && callbacks.onTimeout && callbacks.onTimeout()
      }
    })
  }
  
  dataPartOk(port, address, info) {
    const packet = SteppedBuffer(9)
    packet.addUInt(PACK_DATA_PART_OK, 1)
    packet.addBuffer(info)
    this.send(port, address, packet.getWhole())
  }
  
  dataPartSize(port, address, mpxId, dataLength, partSize, callbacks) {
    const packet = SteppedBuffer(21)
    packet.addUInt(PACK_DATA_PART_SIZE, 1)
    packet.addBuffer(this.uniqueId)
    packet.addBuffer(mpxId)
    packet.addUInt(dataLength, 4)
    packet.addUInt(partSize, 4)
    this.sendWait(port, address, packet.getWhole(), [PACK_DATA_PART_SIZE_OK, PACK_DATA_PART_REJECT, PACK_ERR_NET_LOOP], {
      onRcvd: (msg) => {
        if (msg[0] === PACK_DATA_PART_SIZE_OK) {
          if (msg.slice(1, 5).equals(mpxId)) {
            callbacks && callbacks.onAccepted && callbacks.onAccepted()
          } else {
            return false
          }
        } else if (msg[0] === PACK_DATA_PART_REJECT) {
          if (msg.slice(1, 5).equals(mpxId)) {
            callbacks && callbacks.onRejected && callbacks.onRejected()
          } else {
            return false
          }
        } else {
          callbacks && callbacks.onRejected && callbacks.onRejected()
        }
      },
      onTimeout: () => {
        callbacks && callbacks.onTimeout && callbacks.onTimeout()
      }
    })
  }
  
  dataPartSizeOk(port, address, info) {
    const packet = SteppedBuffer(13)
    packet.addUInt(PACK_DATA_PART_SIZE_OK, 1)
    packet.addBuffer(info)
    this.send(port, address, packet.getWhole())
  }
  
  dataPartReject(port, address, mpxId) {
    const packet = SteppedBuffer(5)
    packet.addUInt(PACK_DATA_PART_REJECT, 1)
    packet.addBuffer(mpxId)
    this.send(port, address, packet.getWhole())
  }
  
  broadcastPing(callback) {
    let calledback = false
    for (const address in storage.servers) {
      const {port} = storage.servers[address]
      p2p.ping(port, address, {
        onPong: () => {
          !calledback && callback && callback()
          calledback = true
        }
      })
    }
  }
  
  online(serverPort, callback) {
    let calledback = false
    const pingCallback = () => {
      !calledback && callback && callback()
      calledback = true
    }
    p2p.listen(serverPort, () => {
      this.broadcastPing(() => {
        pingCallback()
      })
      setTimeout(() => {
        if (!calledback) {
          this.broadcastPing(() => {
            pingCallback()
          })
        }
      }, TIMEOUT)
    })
  }
}

const p2p = new P2P
module.exports = p2p