'use strict'

const fs = require('fs')

const {Conv, Files} = require('./helpers')
const disp = require('./Disp')
const storage = require('./Storage')
const BlockchainPlugin = require('./BlockchainPlugin')
const BufferArray = require('./BufferArray')
const SteppedBuffer = require('./SteppedBuffer')

const BASE_PATH = __dirname + '/../data/'
const BIT_32 = 4294967296
const POSITIVE_32_LIMIT = 4026531840
const ITEM_SIZE = 52

module.exports = class WCache extends BlockchainPlugin {

  constructor(login, open = false, callback) {
    super()
    this.module = 'WCA'
    this.login = login
    this.fileName = WCache.getFileName(login)
    this.path = WCache.getPath(login)
    this.data = SteppedBuffer(4096)
    this.dataIndex = BufferArray({
      step: 37,
      fields: {
        address: {type: 'buffer', size: 25},
        balance: {type: 'number', size: 8},
        start: {type: 'number', size: 4}
      }
    })
    if (open) {
      fs.readFile(this.path, (err, data) => {
        if (err) {
          throw err
        }
        this.data.addBuffer(data)
        this.data.seek(0)
        let start = 0
        while (this.data.untilEnd()) {
          const address = this.data.readBuffer(25)
          start += 25
          const balance = this.data.readUInt(8)
          const outCount = this.data.readUInt(4)
          this.dataIndex.push({address, balance, start})
          start += 12 + outCount * ITEM_SIZE
          this.data.seek(start)
        }
        callback && callback(this)
      })
    } else {
      callback && callback(this)
    }
  }
  
  updateDataIndex(address, balance) {
    const index = this.dataIndex.indexOf('address', address)
    const {start} = this.dataIndex.get(index)
    this.dataIndex.replace(index, {address, balance, start})
  }
  
  static getFileName(login) {
    return 'wallet' + (login === '' ? '' : '-' + login) + '.wca'
  }
  
  static getPath(login) {
    return BASE_PATH + WCache.getFileName(login)
  }
  
  static exists(login) {
    return fs.existsSync(WCache.getPath(login))
  }
  
  static create(login, callback) {
    new WCache(login, false, callback)
  }
  
  static open(login, callback) {
    new WCache(login, true, callback)
  }
  
  // blockchain must be locked
  static getInstance(id, callback) {
    disp.whenClassUnlocked('WCache', (unlock) => {
      const ret = (...args) => {
        unlock()
        callback && callback(...args)
      }
      
      if (!storage.session.wcaches) {
        storage.session.wcaches = {}
      }
      if (storage.session.wcaches[id]) {
        ret(storage.session.wcaches[id])
      } else if (WCache.exists(id)) {
        WCache.open(id, (instance) => {
          instance.register(() => {
            storage.session.wcaches[id] = instance
            ret(instance)
          })
        })
      } else {
        WCache.unregister(id, () => {
          ret(null)
        })
      }
    })
  }
  
  onAddedBlock(blockId, block, callback, currentLockCount) {
    this.logBy('WLT', 'onAddedBlock', blockId)
    const blockUnpacked = block.getData()
    for (const i in blockUnpacked.txList) {
      const tx = blockUnpacked.txList[i]
      const txHash = tx.getHash()
      const txUnpacked = tx.getData()
      txUnpacked.txIns.each(({txHash, outN}) => {
        if (this.setTxOutSpent(txHash, outN, blockId)) {
          this.logBy('WLT', 'IN added to WCA', {txHash: Conv.bufToHex(txHash), outN, blockId})
        }
      })
      txUnpacked.txOuts.each(({address, value}, outN) => {
        if (this.addTxOut(address, blockId, txHash, outN, value, -1)) {
          this.logBy('WLT', 'OUT added to WCA', {txHash: Conv.bufToHex(txHash), outN, value, blockId})
        }
      })
    }
    callback()
  }
  
  onRemovedBlocks(newBlockchainLength, callback, currentLockCount) {
    this.updateTxOutsByBlockchainLength(newBlockchainLength)
    this.logBy('WLT', 'Removed OUTs from WCA', newBlockchainLength)
    callback()
  }
  
  onSaveCache(callback) {
    this.flush(callback)
  }
  
  onSaveCheckpoint(path, callback) {
    Files.copy(this.path, path + this.fileName)
    .then(() => callback())
  }
  
  onLoadCheckpoint(path, callback) {
    Files.copyBack(this.path, path + this.fileName)
    .then(() => callback())
  }
  
  register(callback) {
    this.registerIfNeeded('WCache', this.login, callback)
  }
  
  static unregister(login, callback) {
    BlockchainPlugin.unregisterIfNeeded('WCache', login, callback)
  }
  
  flush(callback) {
    fs.writeFile(this.path, this.data.getWhole(), (err) => {
      if (err) {
        throw err
      }
      callback && callback()
    })
  }
  
  // set cursor in SteppedBuffer to start of address info (if returns true)
  findAddress(address) {
    const index = this.dataIndex.indexOf('address', address)
    if (index >= 0) {
      this.data.seek(this.dataIndex.get(index).start)
    }
    return index
  }
  
  addAddress(address) {
    if (this.findAddress(address) >= 0) {
      return false
    } else {
      this.data.tail()
      this.data.addBuffer(address)
      this.dataIndex.push({address, balance: 0, start: this.data.getPosition()})
      this.data.addUInt(0, 8)
      this.data.addUInt(0, 4)
      return true
    }
  }
  
  addTxOut(address, blockId, txHash, outN, amount, spentInBlockId) {
    const index = this.findAddress(address)
    if (index === -1) {
      return false
    }
    const start = this.data.getPosition()
    const spent = spentInBlockId >= 0
    const toAdd = spent ? 0 : amount
    const balance = this.data.readUInt(8, true) + toAdd
    this.data.addUInt(balance, 8)
    const outCount = this.data.readUInt(4, true)
    this.data.addUInt(outCount + 1, 4)
    this.data.forward(outCount * ITEM_SIZE)
    this.data.reserve(ITEM_SIZE)
    this.data.addUInt(blockId, 4)
    this.data.addBuffer(txHash)
    this.data.addUInt(outN, 4)
    this.data.addUInt(amount, 8)
    this.data.addUInt(spent ? spentInBlockId : BIT_32 - 1, 4)
    
    this.dataIndex.replace(index, {address, balance, start})
    this.dataIndex.eachFrom(index + 1, (data, i) => {
      data.start += ITEM_SIZE
      this.dataIndex.replace(i, data)
    })
    return true
  }
  
  setTxOutSpent(hash, out, spentIn) {
    return this.eachTxOut(({address, txHash, outN, amount, spentInBlockId, addressStart, txOutStart}) => {
      if (hash.equals(txHash) && out === outN) {
        if (spentInBlockId >= 0) {
          return false
        }
        // update balance
        this.data.seek(addressStart + 25)
        const balance = this.data.readUInt(8, true) - amount
        this.data.addUInt(balance, 8)
        
        // update spentInBlockId
        this.data.seek(txOutStart + ITEM_SIZE - 4)
        this.data.addUInt(spentIn, 4)
        
        // update dataIndex
        this.updateDataIndex(address, balance)
        return true
      }
    })
  }
  
  eachTxOut(callback, returnDefault = false) {
    this.data.seek(0)
    while (this.data.untilEnd()) {
      const addressStart = this.data.getPosition()
      const address = this.data.readBuffer(25)
      this.data.forward(8)
      const outCount = this.data.readUInt(4)
      for (let i = 0; i < outCount; i++) {
        const txOutStart = this.data.getPosition()
        const blockId = this.data.readUInt(4)
        const txHash = this.data.readBuffer(32)
        const outN = this.data.readUInt(4)
        const amount = this.data.readUInt(8)
        let spentInBlockId = this.data.readUInt(4)
        if (spentInBlockId > POSITIVE_32_LIMIT) {
          spentInBlockId -= BIT_32
        }
        const res = callback({address, outCount, blockId, txHash, outN, amount, spentInBlockId, addressStart, txOutStart})
        if (res !== undefined) {
          return res
        }
      }
    }
    return returnDefault
  }
  
  eachTxOutByAddress(address, callback, returnDefault = false) {
    if (this.findAddress(address) === -1) {
      return returnDefault
    }
    this.data.forward(8)
    const outCount = this.data.readUInt(4)
    for (let i = 0; i < outCount; i++) {
      const blockId = this.data.readUInt(4)
      const txHash = this.data.readBuffer(32)
      const outN = this.data.readUInt(4)
      const amount = this.data.readUInt(8)
      let spentInBlockId = this.data.readUInt(4)
      if (spentInBlockId > POSITIVE_32_LIMIT) {
        spentInBlockId -= BIT_32
      }
      const res = callback({outCount, blockId, txHash, outN, amount, spentInBlockId})
      if (res !== undefined) {
        return res
      }
    }
    return returnDefault
  }
  
  rEachTxOutByAddress(address, callback, returnDefault = false) {
    if (this.findAddress(address) === -1) {
      return returnDefault
    }
    this.data.forward(8)
    const outCount = this.data.readUInt(4)
    this.data.forward(outCount * ITEM_SIZE)
    for (let i = outCount; i > 0; i--) {
      this.data.forward(-ITEM_SIZE)
      const blockId = this.data.readUInt(4)
      const txHash = this.data.readBuffer(32)
      const outN = this.data.readUInt(4)
      const amount = this.data.readUInt(8)
      let spentInBlockId = this.data.readUInt(4)
      if (spentInBlockId > POSITIVE_32_LIMIT) {
        spentInBlockId -= BIT_32
      }
      const res = callback({outCount, blockId, txHash, outN, amount, spentInBlockId})
      if (res !== undefined) {
        return res
      }
      this.data.forward(-ITEM_SIZE)
    }
    return returnDefault
  }
  
  eachAddress(callback) {
    this.dataIndex.each(({address, balance}) => {
      callback({address, balance})
    })
  }
  
  isTxOutKnown(hash, out) {
    return this.eachTxOut(({txHash, outN}) => {
      if (hash.equals(txHash) && out === outN) {
        return true
      }
    })
  }
  
  updateTxOutsByBlockchainLength(blockchainLength) {
    this.eachTxOut(({address, outCount, blockId, amount, spentInBlockId, addressStart, txOutStart}) => {
      if (blockId >= blockchainLength) {
        // update balance, outCount and dataIndex
        if (spentInBlockId >= 0) {
          this.data.seek(addressStart + 33)
        } else {
          this.data.seek(addressStart + 25)
          const balance = this.data.readUInt(8, true) - amount
          this.data.addUInt(balance, 8)
          
          this.updateDataIndex(address, balance)
        }
        this.data.addUInt(outCount - 1, 4)
        this.data.seek(txOutStart)
        this.data.remove(ITEM_SIZE)
      } else if (spentInBlockId >= blockchainLength) {
        // update balance
        this.data.seek(addressStart + 25)
        const balance = this.data.readUInt(8, true) + amount
        this.data.addUInt(balance, 8)
        
        // update spentInBlockId
        this.data.seek(txOutStart + ITEM_SIZE - 4)
        this.data.addUInt(BIT_32 - 1, 4)
        
        // update dataIndex
        this.updateDataIndex(address, balance)
      }
    })
  }
  
  savePosition(callback) {
    const position = this.data.getPosition()
    callback()
    this.data.seek(position)
  }
  
  getWhole() {
    return this.data.getWhole()
  }
}