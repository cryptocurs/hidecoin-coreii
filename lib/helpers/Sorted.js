'use strict'

module.exports = new class Sorted {

  indexBA(array, value, compare, field) {
    let low = 0
    let high = array ? array.getLength() : low
    
	  while (low < high) {
	    const mid = (low + high) >>> 1
	    compare(array.getField(mid, field), value) > 0
	      ? low = mid + 1
	      : high = mid
	  }
	  return low
  }
  
  indexOfBA(array, value, compare, field) {
    const index = this.indexBA(array, value, compare, field)
    return index < array.getLength()
      ? compare(array.getField(index, field), value)
        ? -1
        : index
      : -1
  }
  
  indexesOfBA(array, value, compare, field) {
    const indexes = []
    const low = this.indexOfBA(array, value, compare, field)
    if (low >= 0) {
      indexes.push(low)
      for (let i = low + 1; i < array.getLength(); i++) {
        if (!compare(array.getField(i, field), value)) {
          indexes.push(i)
        }
      }
    }
    return indexes
  }
  
  compareBuffers(a, b) {
    return Buffer.compare(b, a)
  }
}