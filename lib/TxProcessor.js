'use strict'

const Component = require('./Component')
const blockchain = require('./Blockchain')
const Tx = require('./Tx')

class TxProcessor extends Component {

  constructor() {
    super()
    this.module = 'TXP'
    
    this.broadcast = (hash, data) => {
      const net = require('./Net')
      net.broadcastTxInfoZipped(hash, data)
    }
  }
  
  add(hash, rawData, module = null, callback) {
    if (blockchain.isFreeTxKnown(hash)) {
      callback && callback(false, 'Tx is known')
      return
    }
    
    blockchain.whenUnlocked((unlock) => {
      this.logBy('LCK', 'Locked by TxProcessor.add()')
      const tx = Tx.fromRaw(hash, rawData)
      blockchain.getLength((blockchainLength) => {
        tx.isValidAfter(blockchainLength - 1, null, {}, (valid, err, fee) => {
          unlock()
          if (valid) {
            const feeMustBe = Tx.calcFee(tx.getRawDataLength())
            if (fee >= feeMustBe) {
              if (!blockchain.isFreeTxKnown(hash)) {
                this.logBy(module || this.module, '{green-fg}Free tx ACCEPTED (' + fee + '/' + feeMustBe + '){/green-fg}')
                blockchain.addFreeTx(tx)
                this.broadcast(hash, rawData)
                callback && callback(true, null, fee)
              } else {
                this.logBy(module || this.module, '{red-fg}Free tx REJECTED: Known{/red-fg}')
                callback && callback(false, 'Known')
              }
            } else {
              this.logBy(module || this.module, '{yellow-fg}Free tx REJECTED: Too small fee (' + fee + '/' + feeMustBe + '){/yellow-fg}')
              callback && callback(false, 'Too small fee', fee)
            }
          } else {
            this.logBy(module || this.module, '{red-fg}Free tx REJECTED: ' + err + '{/red-fg}')
            callback && callback(false, err)
          }
        }, 1)
      }, 1)
    })
  }
}

const txProcessor = new TxProcessor
module.exports = txProcessor