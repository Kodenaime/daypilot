import { encrypt, decrypt } from './encryption';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log('Running AES-256-GCM Encryption Tests...');

  try {
    // Test 1: Successful encrypt & decrypt cycle
    const secretMessage = 'Hello, this is a highly confidential Google OAuth token!';
    console.log(`Original Text: "${secretMessage}"`);
    
    const cipherText = encrypt(secretMessage);
    console.log(`Encrypted Format: "${cipherText}"`);
    assert(cipherText !== secretMessage, 'Encrypted text should not match plain text');
    assert(cipherText.split(':').length === 3, 'Output should consist of three parts split by colons');

    const decryptedText = decrypt(cipherText);
    console.log(`Decrypted Text: "${decryptedText}"`);
    assert(decryptedText === secretMessage, 'Decrypted text should match the original secret message');
    console.log('Test 1: Passed (Round-trip integrity validated)');

    // Test 2: Integrity check fails on corrupted payload
    const corruptedCipherText = cipherText.replace(/a/g, 'b');
    let decryptionFailed = false;
    try {
      decrypt(corruptedCipherText);
    } catch (e) {
      decryptionFailed = true;
      console.log(`Test 2: Passed (Corrupted ciphertext error: "${(e as Error).message}")`);
    }
    assert(decryptionFailed, 'Decryption of corrupted payload should have failed');

    console.log('All encryption tests passed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Encryption unit test failed:', error);
    process.exit(1);
  }
}

runTests();
