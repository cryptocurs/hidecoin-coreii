'use strict'

const ntpClient = require('ntp-client')

module.exports = new class Time {

  constructor() {
    this.timeOffset = 0
    this.globalTimeReady = false
  }
  
  synchronize(callback) {
    ntpClient.getNetworkTime('pool.ntp.org', 123, (err, date) => {
      if (err) {
        this.synchronize(callback)
      } else {
        this.timeOffset = parseInt(date.getTime() / 1000) - this.local()
        this.globalTimeReady = true
        callback && callback(this.timeOffset)
      }
    })
  }
  
  localMs() {
    return new Date().getTime()
  }
  
  local() {
    return parseInt(this.localMs() / 1000)
  }
  
  global() {
    if (!this.globalTimeReady) {
      throw new Error('Global time is not ready')
    }
    
    return this.local() + this.timeOffset
  }
  
  doNowAndSetInterval(callback, interval) {
    setInterval(callback, interval)
    callback()
  }
}