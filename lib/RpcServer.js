'use strict'

const R = require('ramda')
const {Server} = require('json-rpc2')

const {Conv} = require('./helpers')
const Component = require('./Component')
const storage = require('./Storage')

class RpcServer extends Component {

  constructor() {
    super()
    this.module = 'RPC'
    this.server = Server.$create()
    this.lastRequestId = 0
    this.activeRequests = 0
    
    this.checkBusy = (callback) => {
      if (this.activeRequests) {
        callback('busy')
        return true
      } else {
        return false
      }
    }
    
    /* Miner */
    this.server.expose('miner', {
      gettask: (params, opt, callback) => {
        if (this.checkBusy(callback)) {
          return
        }
        this.activeRequests++
        const requestId = this.lastRequestId++
        this.log('#' + requestId + ' Rcvd miner.gettask, nonce=' + params.nonce + ', hps=' + params.hps)
        if ((params.nonce !== undefined) && (params.hps !== undefined)) {
          storage.session.stat.hpsList[params.nonce] = params.hps
          storage.session.stat.hps = Conv.countToStr(R.reduce((a, b) => a + b, 0, R.values(storage.session.stat.hpsList)))
        }
        if (storage.session.miner.task && storage.session.miner.task.active) {
          this.log('#' + requestId + ' Sent {green-fg}active=1{/green-fg}')
          this.activeRequests--
          callback(null, storage.session.miner.task)
        } else {
          this.log('#' + requestId + ' Sent {red-fg}active=0{/red-fg}')
          this.activeRequests--
          callback(null, {
            active: 0
          })
        }
      },
      blockfound: (params, opt, callback) => {
        if (this.checkBusy(callback)) {
          return
        }
        this.activeRequests++
        const requestId = this.lastRequestId++
        this.log('#' + requestId + ' Rcvd miner.blockfound, txs=' + params.txHashList.length)
        storage.emit('rpcMinerBlockFound', params.hash, params.blockData, params.txHashList)
        this.log('#' + requestId + ' Sent {yellow-fg}status=success{/yellow-fg}')
        this.activeRequests--
        callback(null, {
          status: 'success'
        })
      },
      blockconfirmationscount: (params, opt, callback) => {
        if (this.checkBusy(callback)) {
          return
        }
        this.activeRequests++
        const requestId = this.lastRequestId++
        this.log('#' + requestId + ' Rcvd miner.blockconfirmationscount')
        storage.emit('rpcBlockConfirmationsCount', params.hash, (count) => {
          this.log('#' + requestId + ' Sent {yellow-fg}count=' + count + '{/yellow-fg}')
          this.activeRequests--
          callback(null, {
            count
          })
        })
      }
    })
    
    /* Wallet */
    this.server.expose('wallet', {
      open: (params, opt, callback) => {
        if (this.checkBusy(callback)) {
          return
        }
        this.activeRequests++
        const requestId = this.lastRequestId++
        this.log('#' + requestId + ' Rcvd wallet.open')
        storage.emit('walletOpen', params.password, (opened) => {
          if (opened) {
            this.activeRequests--
            callback(null, {
              status: 'success'
            })
          } else {
            this.activeRequests--
            callback('wrong password')
          }
        })
      },
      sendcoins: (params, opt, callback) => {
        if (this.checkBusy(callback)) {
          return
        }
        this.activeRequests++
        const requestId = this.lastRequestId++
        this.log('#' + requestId + ' Rcvd wallet.sendcoins')
        storage.emit('walletSendCoins', params.recipients, (valid, err, fee) => {
          if (err) {
            this.activeRequests--
            callback(err)
          } else {
            this.activeRequests--
            callback(null, {
              status: 'success',
              fee
            })
          }
        })
        this.log('#' + requestId + ' Sent {yellow-fg}status=success{/yellow-fg}')
      }
    })
    
    this.server.listen(5839, 'localhost')
  }
}

const rpcServer = new RpcServer
module.exports = rpcServer