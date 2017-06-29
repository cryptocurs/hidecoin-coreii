'use strict'

const R = require('ramda')

module.exports = new class IP {

  constructor() {
    this.valuesOf = (iterator) => {
      const res = []
      for (const i of iterator) {
        res.push(i)
      }
      return res
    }
  }
  
  isv4(ip) {
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
  }
  
  v4Tov6(ipv4) {
    return '::ffff:' + ipv4
  }
  
  v6Tov4(ipv6) {
    return (ipv6.substr(0, 7) === '::ffff:' ? ipv6.substr(7) : false)
  }
  
  v6Full(ip) {
    const index = ip.indexOf('::')
    let segments = []
    if (index >= 0) {
      const before = ip.slice(0, index).split(':')
      const after = ip.slice(index + 2).split(':')
      const toAdd = 8 - before.length - after.length
      segments = [...before, ...R.repeat('', toAdd), ...after]
    } else {
      segments = ip.split(':')
    }
    return R.join(':', R.map(i => _.padStart(i, 4, '0'), segments))
  }
  
  v4Pack(ip) {
    return Buffer.concat(R.map(i => Buffer.from([i]), ip.split('.')))
  }
  
  v6Pack(ip) {
    return Buffer.concat(R.map(i => Buffer.from(R.map(t => ('0x' + t) >> 0, i.match(/.{2}/g))), this.ipv6Full(ip).split(':')))
  }
  
  v4Unpack(ip) {
    return R.join('.', this.valuesOf(ip.values()))
  }
  
  v6Unpack(ip) {
    const values = []
    const accum = []
    let x = 0
    for (const i of ip.values()) {
      accum.push(i)
      if (x % 2) {
        values.push(accum)
        accum.length = 0
      }
      x++
    }
    return R.join(':', R.map(i => Buffer.from([i[0], i[1]]).toString('hex'), values))
  }
}