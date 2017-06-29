'use strict'

const storage = require('./Storage')
const Component = require('./Component')
const ifc = require('./Interface')
const Wallet = require('./Wallet')
const blockchain = require('./Blockchain')
const Address = require('./Address')

class WalletUI extends Component {

  constructor() {
    super()
    this.module = 'WUI'
    this.busy = false
    storage.session.wallet = null
    this.addresses = []
    this.showingAddresses = false
    
    blockchain.on('changed', () => {
      if (this.showingAddresses) {
        this.showBalances()
      }
    })
    
    storage.on('walletOpen', (password, callback) => {
      this.openWallet(password, callback)
    })
    
    storage.on('walletSendCoins', (recipients, callback) => {
      storage.session.wallet.sendCoins(recipients, null, callback)
    })
    
    this.openWallet = (password, callback) => {
      if (storage.session.wallet && storage.session.wallet.isOpened()) {
        callback && callback(true)
        return
      }
      
      this.busy = true
      storage.session.wallet = Wallet.use(password)
  
      storage.session.wallet.on('changed', () => {
        if (this.showingAddresses) {
          this.showBalances()
        }
      })
      
      storage.session.wallet.open((opened) => {
        this.busy = false
        callback(opened)
      })
    }
    
    this.askPassword = () => {
      this.showingAddresses = false
      ifc.ask('Enter password', (cancelled, password) => {
        if (cancelled) {
          ifc.openWindow('app')
          return
        }
        this.showBalances()
        this.openWallet(password, (opened) => {
          if (opened) {
            this.showBalances()
          } else {
            storage.session.wallet = null
            ifc.error('Wrong password', () => {
              this.askPassword()
            })
          }
        })
      }, true)
    }
    
    this.showForm = (name, title) => {
      this.showingAddresses = false
      switch (name) {
        case 'sendCoins':
          ifc.form({
            title: 'Send coins from ' + title,
            items: [
              {
                name: 'address',
                title: 'Address',
                type: 'textarea'
              },
              {
                name: 'amount',
                title: 'Amount',
                type: 'textarea'
              }
            ],
            onSubmit: ({address, amount}) => {
              if (!Address.isValid(address)) {
                ifc.error('Wrong address', () => {
                  this.showBalances()
                })
                return
              }
              if (!amount.match(/^\d*\.{0,1}\d*$/g)) {
                ifc.error('Wrong amount', () => {
                  this.showBalances()
                })
                return
              }
              amount = parseFloat(amount)
              storage.session.wallet.sendCoins([{address, amount}], [title], (valid, err, fee) => {
                if (valid) {
                  ifc.notify('Coins have been with fee ' + fee + ' micoins', () => {
                    this.showBalances()
                  })
                } else {
                  ifc.error('Tx is not valid: ' + err, () => {
                    this.showBalances()
                  })
                }
              })
            },
            onCancel: () => {
              this.showBalances()
            }
          })
          break
        case 'sendCoinsAll':
          ifc.form({
            title: 'Send coins',
            items: [
              {
                name: 'address',
                title: 'Address',
                type: 'textarea'
              },
              {
                name: 'amount',
                title: 'Amount',
                type: 'textarea'
              }
            ],
            onSubmit: ({address, amount}) => {
              if (!Address.isValid(address)) {
                ifc.error('Wrong address', () => {
                  this.showBalances()
                })
                return
              }
              if (!amount.match(/^\d*\.{0,1}\d*$/g)) {
                ifc.error('Wrong amount', () => {
                  this.showBalances()
                })
                return
              }
              amount = parseFloat(amount)
              storage.session.wallet.sendCoins([{address, amount}], null, (valid, err, fee) => {
                if (valid) {
                  ifc.notify('Coins have been with fee ' + fee + ' micoins', () => {
                    this.showBalances()
                  })
                } else {
                  ifc.error('Tx is not valid: ' + err, () => {
                    this.showBalances()
                  })
                }
              })
            },
            onCancel: () => {
              this.showBalances()
            }
          })
          break
        default:
          throw new Error('Wrong form name')
      }
    }
    
    this.showMenu = (name, title) => {
      this.showingAddresses = false
      switch (name) {
        case 'address':
          ifc.menu({title}, [
            {
              title: 'Send from this address',
              action: () => {
                this.showForm('sendCoins', title)
              }
            },
            {
              title: 'Return back',
              action: () => {
                this.showBalances()
              }
            }
          ])
          break
        case 'options':
          ifc.menu({title: 'Options'}, [
            {
              title: 'Send from this wallet',
              action: () => {
                this.showForm('sendCoinsAll')
              }
            },
            {
              title: 'Create address',
              action: () => {
                storage.session.wallet.createAddress(() => {
                  this.showBalances()
                })
              }
            },
            {
              title: 'Return back',
              action: () => {
                this.showBalances()
              }
            }
          ])
          break
        default:
          throw new Error('Wrong menu name')
      }
    }
    
    this.onSelectAddress = (selected) => {
      const {address} = this.addresses[selected]
      this.showMenu('address', address)
    }
    
    this.showBalances = () => {
      this.showingAddresses = true
      storage.session.wallet && storage.session.wallet.getBalances((balances) => {
        storage.session.wallet.getSoftBalances((softBalances) => {
          storage.session.wallet.getFreeBalances((freeBalances) => {
            const addresses = []
            for (const address in balances) {
              const balance = balances[address] / 100000000
              const softBalance = softBalances[address] / 100000000
              const freeBalance = freeBalances[address] / 100000000
              addresses.push({address, hard: (balance - softBalance).toFixed(8), soft: softBalance.toFixed(8), free: freeBalance ? freeBalance.toFixed(2) : ''})
            }
            this.addresses = addresses
            ifc.updateWindow('wallet', {currentBox: 'addresses', addresses, onSelect: this.onSelectAddress})
          })
        })
      })
    }
    
    ifc.on('windowOpened', (windowName) => {
      if (windowName === 'wallet') {
        if (!storage.session.synchronizer.firstReady) {
          ifc.error('Blockchain is still synchronizing', () => {
            ifc.openWindow('app')
          })
          return
        }
        if (this.busy) {
          
        } else {
          if (storage.session.wallet) {
            this.showBalances()
          } else {
            this.askPassword()
          }
        }
      }
    })
    
    ifc.on('windowClosed', (windowName) => {
      if (windowName === 'wallet') {
        
      }
    })
  }
}

const walletUI = new WalletUI
module.exports = walletUI