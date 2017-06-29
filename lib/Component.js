'use strict'

const moment = require('moment')
const R = require('ramda')
const EventEmitter = require('events')

const disp = require('./Disp')
const storage = require('./Storage')

module.exports = class Component extends EventEmitter {

  constructor() {
    super()
    this.module = 'UNK'
    this.locks = 0
    
    this.isLocked = () => {
      return this.locks > 0
    }
    
    this.log = (...data) => {
      this.logBy(this.module, ...data)
    }
    
    this.logBy = (module, ...data) => {
      if (!storage.session.disableLog && (!storage.logIgnoreModules || !storage.logIgnoreModules[module]) && (!storage.logTrackModule || storage.logTrackModule === module)) {
        const dataTimed = ['[' + moment().format('HH:mm:ss') + ' ' + module + ']#', ...data]
        const dataToLog = R.contains(module, ['FND', 'WLT', 'COL']) ? [module, ...dataTimed] : dataTimed
        storage.emit('log', ...dataToLog) || console.log(...dataToLog)
      }
    }
    
    this.logAlias = (alias, data) => {
      this.logAliasBy(this.module, alias, data)
    }
    
    this.logAliasBy = (module, alias, data) => {
      if (!storage.session.disableLog) {
        storage.emit('logAlias', module, alias, data) || console.log(data)
      }
    }
    
    this.logAliasClear = (alias) => {
      storage.emit('logAliasClear', this.module, alias)
    }
  }
  
  lock(times = 1) {
    this.locks += times
  }
  
  unlock(times = 1) {
    this.locks -= times
  }
  
  whenUnlocked(callback, allowableLockCount = 0) {
    if (disp.isSigTerm()) {
      return
    }
    
    if (this.locks > allowableLockCount) {
      setTimeout(() => {
        this.whenUnlocked(callback, allowableLockCount)
      }, 10)
    } else {
      this.logBy('LCK', 'Locking with', allowableLockCount)
      this.lock()
      callback(() => {
        this.logBy('LCK', 'Unlocking with', allowableLockCount)
        this.unlock()
      })
    }
  }
}