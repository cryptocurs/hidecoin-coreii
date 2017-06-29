'use strict'

const EventEmitter = require('events')

class Disp extends EventEmitter {

  constructor() {
    super()
    this.locks = {
      term: 0
    }
    this.classLocks = {}
    this.signals = {
      term: false
    }
  }
  
  terminate(beforeExit) {
    this.setSigTerm()
    if (this.locks.term) {
      setTimeout(() => {
        this.terminate()
      }, 1000)
    } else {
      beforeExit && beforeExit()
      process.exit()
    }
  }
  
  lockTerm() {
    this.locks.term++
  }
  
  unlockTerm() {
    this.locks.term--
  }
  
  setSigTerm() {
    if (!this.signals.term) {
      this.emit('sigTerm')
    }
    this.signals.term = true
  }
  
  unsetSigTerm() {
    this.signals.term = false
  }
  
  isSigTerm() {
    return this.signals.term
  }
  
  lockClass(className) {
    this.classLocks[className] = (this.classLocks[className] || 0) + 1
  }
  
  unlockClass(className) {
    this.classLocks[className]--
  }
  
  whenClassUnlocked(className, callback, allowableLockCount = 0) {
    if (this.isSigTerm()) {
      return
    }
    
    if (this.classLocks[className] > allowableLockCount) {
      setTimeout(() => {
        this.whenClassUnlocked(className, callback, allowableLockCount)
      }, 10)
    } else {
      this.lockClass(className)
      callback(() => {
        this.unlockClass(className)
      })
    }
  }
}

const disp = new Disp
module.exports = disp