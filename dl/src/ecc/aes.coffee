# https://code.google.com/p/crypto-js
CryptoJS = require("crypto-js")
assert = require("assert")
ByteBuffer = require("../common/bytebuffer")
Long = ByteBuffer.Long
hash = require("../common/hash")

class Aes

    constructor: (@iv, @key) ->
        
    clear:->@iv = @key = undefined
    
    # TODO arg should be a binary type... HEX works best with crypto-js
    Aes.fromSha512 = (hash) ->
        assert.equal hash.length, 128, "A Sha512 in HEX should be 128 characters long, instead got #{hash.length}"
        #https://github.com/InvictusInnovations/fc/blob/978de7885a8065bc84b07bfb65b642204e894f55/src/crypto/aes.cpp#L330
        #Bitshares aes_decrypt uses part of the password hash as the initilization vector
        iv = CryptoJS.enc.Hex.parse(hash.substring(64, 96))
        key = CryptoJS.enc.Hex.parse(hash.substring(0, 64))
        new Aes(iv, key)
    
    Aes.fromSeed = (seed) ->
        assert seed, "seed is required"
        _hash = hash.sha512 seed
        _hash = _hash.toString('hex')
        Aes.fromSha512(_hash)
    
    Aes.decrypt_with_checksum = (private_key, public_key, nonce, message) ->
        unless Buffer.isBuffer message
            message = new Buffer message
        
        S = private_key.get_shared_secret public_key
        aes = Aes.fromSeed Buffer.concat [
            new Buffer(nonce)
            new Buffer(S.toString('hex'))
        ]
        planebuffer = aes.decrypt message
        unless planebuffer.length >= 4
            throw new Error "Invalid key, could not decrypt message"
        
        #console.log('... planebuffer',planebuffer)
        checksum = planebuffer.slice 0, 4
        plaintext = planebuffer.slice(4).toString()
        
        #console.log('... checksum',checksum.toString('hex'))
        #console.log('... plaintext',plaintext)
        
        # reverse() converts to big-endian (matches the c++ memo)
        new_checksum = hash.sha256 plaintext
        new_checksum = new_checksum.slice 0, 4
        new_checksum = new_checksum.toString('binary').split("").reverse().join("")
        
        unless checksum.toString('binary') is new_checksum
            throw new Error "Invalid key, could not decrypt message"
        
        plaintext
    
    Aes.encrypt_with_checksum = (private_key, public_key, nonce, message) ->
        unless Buffer.isBuffer message
            message = new Buffer message
        
        S = private_key.get_shared_secret public_key
        aes = Aes.fromSeed Buffer.concat [
            new Buffer(nonce)
            new Buffer(S.toString('hex'))
        ]
        # reverse() converts to big-endian (matches the c++ memo)
        checksum = hash.sha256(message).slice 0,4
        checksum = checksum.toString('binary').split("").reverse().join("")
        checksum = new Buffer(checksum, 'binary')
        payload = Buffer.concat [checksum, message]
        aes.encrypt payload
    
    _decrypt_word_array: (cipher) ->
        # https://code.google.com/p/crypto-js/#Custom_Key_and_IV
        # see wallet_records.cpp master_key::decrypt_key
        CryptoJS.AES.decrypt(
          ciphertext: cipher
          salt: null
        , @key,
          iv: @iv
        )
    
    _encrypt_word_array: (plaintext) ->
        #https://code.google.com/p/crypto-js/issues/detail?id=85
        cipher = CryptoJS.AES.encrypt plaintext, @key, {iv: @iv}
        CryptoJS.enc.Base64.parse cipher.toString()

    decrypt: (cipher_buffer) ->
        if typeof cipher_buffer is "string"
            cipher_buffer = new Buffer(cipher_buffer, 'binary')
        unless Buffer.isBuffer cipher_buffer
            throw new Error "buffer required"
        assert cipher_buffer, "Missing cipher text"
        # hex is the only common format
        hex = @decryptHex(cipher_buffer.toString('hex'))
        new Buffer(hex, 'hex')
        
    encrypt: (plaintext) ->
        if typeof plaintext is "string"
            plaintext = new Buffer(plaintext, 'binary')
        unless Buffer.isBuffer plaintext
            throw new Error "buffer required"
        #assert plaintext, "Missing plain text"
        # hex is the only common format
        hex = @encryptHex(plaintext.toString('hex'))
        new Buffer(hex, 'hex')

    encryptToHex: (plaintext) ->
        if typeof plaintext is "string"
            plaintext = new Buffer(plaintext, 'binary')
        unless Buffer.isBuffer plaintext
            throw new Error "buffer required"
        #assert plaintext, "Missing plain text"
        # hex is the only common format
        @encryptHex(plaintext.toString('hex'))
        
    decryptHex: (cipher) ->
        assert cipher, "Missing cipher text"
        # Convert data into word arrays (used by Crypto)
        cipher_array = CryptoJS.enc.Hex.parse cipher
        plainwords = @_decrypt_word_array cipher_array
        CryptoJS.enc.Hex.stringify plainwords
    
    decryptHexToText: (cipher) ->
        assert cipher, "Missing cipher text"
        # Convert data into word arrays (used by Crypto)
        cipher_array = CryptoJS.enc.Hex.parse cipher
        plainwords = @_decrypt_word_array cipher_array
        plainhex = CryptoJS.enc.Hex.stringify plainwords
        new Buffer(plainhex, 'hex').toString()
        
    encryptHex: (plainhex) ->
        #assert plainhex, "Missing plain text"
        plain_array = CryptoJS.enc.Hex.parse plainhex
        cipher_array = @_encrypt_word_array plain_array
        CryptoJS.enc.Hex.stringify cipher_array

module.exports = Aes

