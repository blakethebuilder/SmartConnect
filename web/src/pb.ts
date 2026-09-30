import PocketBase from 'pocketbase'

// ponytail: /pb prefix proxied by nginx to PB; SDK appends /api/collections itself
export const pb = new PocketBase(import.meta.env.PROD ? '/pb' : 'http://127.0.0.1:8090')

export const API = import.meta.env.PROD ? '/api' : 'http://127.0.0.1:8000'
