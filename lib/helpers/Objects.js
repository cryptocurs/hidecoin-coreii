'use strict'

const Conv = require('./Conv')

module.exports = new class Objects {

  restore(obj) {
    if (typeof obj === 'object') {
      for (const k in obj) {
        if (obj[k] && obj[k].type && obj[k].type === 'Buffer') {
          obj[k] = Buffer.from(obj[k].data)
        } else {
          this.restore(obj[k])
        }
      }
    }
  }
  
  clone(obj) {
    let res
    if (typeof obj === 'object') {
      if (obj instanceof Buffer) {
        res = obj
      } else {
        res = obj instanceof Array ? [] : {}
        for (const k in obj) {
          res[k] = this.clone(obj[k])
        }
      }
    } else {
      res = obj
    }
    return res
  }
  
  base(obj) {
    if (typeof obj === 'object') {
      for (const k in obj) {
        if (obj[k] instanceof Buffer) {
          obj[k] = {
            type: 'Based',
            data: Conv.bufToBase(obj[k])
          }
        } else {
          this.base(obj[k])
        }
      }
    }
  }
  
  unbase(obj) {
    if (typeof obj === 'object') {
      for (const k in obj) {
        if (obj[k] && obj[k].type && obj[k].type === 'Based') {
          obj[k] = Conv.baseToBuf(obj[k].data)
        } else {
          this.unbase(obj[k])
        }
      }
    }
  }
}