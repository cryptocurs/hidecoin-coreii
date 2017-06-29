'use strict'

const R = require('ramda')
const _ = require('lodash')

const Component = require('./Component')
const {Conv, Random, Time} = require('./helpers')
const p2p = require('./P2P')
const SteppedBuffer = require('./SteppedBuffer')
const Cmd = require('./Cmd')

const MAX_DATA_SIZE = 256
const MAX_MPX_SIZE = 1572864

class P2X extends Component {

  constructor() {
    super()
    this.module = 'P2X'
    this.mpxs = {}
    
    p2p.on('online', () => {
      this.emit('online')
    })
    
    p2p.on('newServer', (port, address, isIpv6) => {
      this.emit('newServer', port, address, isIpv6)
    })
    
    p2p.on('rcvdData', (port, address, data) => {
      this.emit('rcvdData', port, address, data)
    })
    
    p2p.on('rcvdDataPartSize', (port, address, data, callback) => {
      const dataLength = data.readUInt32BE(13)
      const partSize = data.readUInt32BE(17)
      if (dataLength > MAX_MPX_SIZE || partSize > MAX_DATA_SIZE) {
        callback(false)
        return
      } else {
        callback(true)
      }
      
      const partsCount = Math.ceil(dataLength / partSize)
      const mpxId = data.slice(9, 13)
      const mpxIdStr = '' + port + '|' + address + '|' + Conv.bufToHex(mpxId)
      this.mpxs[mpxIdStr] = {
        started: Time.localMs(),
        partSize,
        partsCount,
        partsReceived: R.repeat(false, partsCount),
        partsReceivedCount: 0,
        dataLength: dataLength,
        receivedLength: 0,
        buffer: SteppedBuffer(MAX_DATA_SIZE),
        lastPartAccepted: Time.localMs(),
        command: 'UNKNOWN'
      }
      this.logAlias(mpxIdStr, 'MPX ' + mpxIdStr + ' receiving...')
    })
    
    p2p.on('rcvdDataPart', (port, address, data, callback) => {
      const mpxId = data.slice(9, 13)
      const mpxIdStr = '' + port + '|' + address + '|' + Conv.bufToHex(mpxId)
      const mpx = this.mpxs[mpxIdStr]
      if (!mpx) {
        this.log('MPX part rejected: unknown ID')
        callback(false)
        return
      }
      
      const partId = data.readUInt32BE(13)
      if (partId >= mpx.partsCount || mpx.partsReceived[partId]) {
        this.log('MPX part rejected: unexpected part ID')
        callback(false)
        return
      }
      
      const received = data.slice(17)
      if (received.length > mpx.partSize) {
        this.log('MPX part rejected: wrong size')
        callback(false)
        return
      }
      
      const acceptPart = () => {
        mpx.buffer.seek(partId * mpx.partSize)
        mpx.buffer.addBuffer(received)
        mpx.receivedLength += received.length
        mpx.partsReceived[partId] = true
        mpx.partsReceivedCount++
        mpx.lastPartAccepted = Time.localMs()
      }
      
      if (!mpx.partsReceived[0]) {
        if (!partId) {
          mpx.command = Cmd.toStr(received[0])
          let processors = 0
          let accept = false
          // callbacks: processing, processed
          this.emit('mpxRcvdFirst', mpxIdStr, received, () => {
            processors++
          }, (accepted) => {
            processors--
            if (accepted && !accept) {
              accept = true
              acceptPart()
              callback(true)
            }
            if (!processors && !accept) {
              this.log('MPX rejected by processor')
              callback(false)
              delete this.mpxs[mpxIdStr]
              this.logAliasClear(mpxIdStr)
              this.emit('mpxAborted', mpxIdStr)
            }
          })
        } else {
          this.log('MPX part rejected: no first part')
          callback(false)
          delete this.mpxs[mpxIdStr]
          this.logAliasClear(mpxIdStr)
          this.emit('mpxAborted', mpxIdStr)
          return
        }
      } else {
        acceptPart()
        callback(true)
        
        const rcvd = mpx.partsReceivedCount * 20 / mpx.partsCount >> 0
        this.logAlias(mpxIdStr, 'MPX RCV ' + _.padEnd(address, 16) + _.repeat('|', rcvd) + _.repeat('.', 20 - rcvd) + ' (' + mpx.command + ')')
        
        if (mpx.receivedLength === mpx.dataLength) {
          let processors = 0
          // callbacks: processing, processed
          this.logAliasClear(mpxIdStr)
          this.emit('mpxRcvdFully', mpxIdStr, port, address, mpx.buffer.getWhole(), () => {
            processors++
          }, () => {
            processors--
            if (!processors) {
              this.logAliasClear(mpxIdStr)
              delete this.mpxs[mpxIdStr]
            }
          })
          if (!processors) {
            this.logAliasClear(mpxIdStr)
            delete this.mpxs[mpxIdStr]
          }
        }
      }
    })
    
    setInterval(() => {
      const now = Time.localMs()
      for (const mpxIdStr in this.mpxs) {
        if (this.mpxs[mpxIdStr].started < now - 30000 || this.mpxs[mpxIdStr].lastPartAccepted < now - 10000) {
          this.logAliasClear(mpxIdStr)
          delete this.mpxs[mpxIdStr]
          this.emit('mpxAborted', mpxIdStr)
        }
      }
    }, 5000)
  }
  
  send(port, address, data, callbacks) {
    const dataLength = data.length
    if (dataLength > MAX_DATA_SIZE) {
      p2p.ping(port, address, {
        onPong: () => {
          callbacks && callbacks.onPong && callbacks.onPong()
          
          const mpxId = Random.bytes(4)
          const mpxIdStr = Conv.bufToHex(mpxId)
          this.log('MPX', mpxIdStr, dataLength, 'bytes starting')
          p2p.dataPartSize(port, address, mpxId, dataLength, MAX_DATA_SIZE, {
            onAccepted: () => {
              callbacks && callbacks.onMpxStarted && callbacks.onMpxStarted()
              
              const partsCount = Math.ceil(dataLength / MAX_DATA_SIZE)
              const sendPart = (i) => {
                const start = i * MAX_DATA_SIZE
                p2p.dataPart(port, address, mpxId, i, data.slice(start, start + MAX_DATA_SIZE), {
                  onAccepted: () => {
                    if (i < partsCount - 1) {
                      setImmediate(() => {
                        this.log('Sending part', i)
                        sendPart(++i)
                      })
                    } else {
                      callbacks && callbacks.onAccepted && callbacks.onAccepted()
                      this.log('Accepted')
                    }
                  },
                  onRejected: () => {
                    callbacks && callbacks.onRejected && callbacks.onRejected()
                    this.log('Rejected')
                  },
                  onTimeout: () => {
                    callbacks && callbacks.onTimeout && callbacks.onTimeout()
                    this.log('Timeout')
                  }
                })
              }
              sendPart(0)
            },
            onRejected: () => {
              callbacks && callbacks.onRejected && callbacks.onRejected()
              this.log('Rejected')
            },
            onTimeout: () => {
              callbacks && callbacks.onTimeout && callbacks.onTimeout()
              this.log('Timeout')
            }
          })
        },
        onTimeout: () => {
          callbacks && callbacks.onTimeout && callbacks.onTimeout()
        }
      })
    } else {
      p2p.ping(port, address, {
        onPong: () => {
          callbacks && callbacks.onPong && callbacks.onPong()
          
          p2p.data(port, address, data, {
            onAccepted: () => {
              callbacks && callbacks.onAccepted && callbacks.onAccepted()
            },
            onRejected: () => {
              callbacks && callbacks.onRejected && callbacks.onRejected()
            },
            onTimeout: () => {
              callbacks && callbacks.onTimeout && callbacks.onTimeout()
            }
          })
        },
        onTimeout: () => {
          callbacks && callbacks.onTimeout && callbacks.onTimeout()
        }
      })
    }
  }
  
  abortMpxsByCmdStr(cmdStr) {
    for (const mpxIdStr in this.mpxs) {
      this.logAliasClear(mpxIdStr)
      delete this.mpxs[mpxIdStr]
      this.emit('mpxAborted', mpxIdStr)
    }
  }
  
  getMpxsCountByCmdStr(cmdStr) {
    return R.reduce((acc, item) => {
      return acc + (item.command === cmdStr ? 1 : 0)
    }, 0, R.values(this.mpxs))
  }
  
  getMaxMpxSize() {
    return MAX_MPX_SIZE
  }
}

const p2x = new P2X
module.exports = p2x