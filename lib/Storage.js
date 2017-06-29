'use strict'

const fs = require('fs')

const {Objects} = require('./helpers')
const disp = require('./Disp')

class Storage {

  constructor() {
    this.session = {}
    this.callbacks = {}
    this.defaultCallbacks = {}
  }
  
  init({base, path, pathInit}) {
    this.path = base + path
    this.pathInit = base + pathInit
    if (!fs.existsSync(this.path)) {
      if (!fs.existsSync(this.pathInit)) {
        console.log('Fatal error: no storage')
        process.exit()
      }
			var data = JSON.parse(fs.readFileSync(this.pathInit))
    } else {
      var data = JSON.parse(fs.readFileSync(this.path))
    }
    Objects.unbase(data)
    for (const i in data) {
      this[i] = data[i]
    }
  }
  
  flush(callback) {
    disp.whenClassUnlocked('Storage', (unlock) => {
      const toWrite = {}
      for (let i in this) {
        if (i !== 'path' && i !== 'pathInit' && i !== 'session' && i !== 'callbacks' && i !== 'defaultCallbacks') {
          toWrite[i] = Objects.clone(this[i])
        }
      }
      Objects.base(toWrite)
      fs.writeFile(this.path, JSON.stringify(toWrite), (err) => {
        if (err) {
          throw err
        }
        unlock()
        callback && callback()
      })
    })
  }
  
  reset() {
    const data = JSON.parse(fs.readFileSync(this.pathInit))
    for (const i in data) {
      this[i] = data[i]
    }
  }
  
  defaultOn(event, callback) {
    this.defaultCallbacks[event] = callback
  }
  
  defaultOff(event, callback) {
    this.defaultCallbacks[event] = null
  }
  
  on(event, callback) {
    if (!this.callbacks[event])
      this.callbacks[event] = []
    this.callbacks[event].push(callback)
    return [event, this.callbacks[event].length - 1]
  }
  
  off(listener) {
    this.callbacks[listener[0]][listener[1]] = null
  }
  
  emit(event, ...data) {
    let responses = 0
    if (this.callbacks[event]) {
      for (const i in this.callbacks[event]) {
        this.callbacks[event][i] && ++responses && this.callbacks[event][i](...data)
      }
    }
    !responses && this.defaultCallbacks[event] && this.defaultCallbacks[event](...data)
    return responses
  }
}

const storage = new Storage
module.exports = storage