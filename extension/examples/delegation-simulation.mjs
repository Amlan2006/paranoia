// Only eth_chainId, eth_blockNumber, eth_getCode, eth_getBalance and eth_call.
// State overrides apply to individual read-only calls and are never broadcast.
export const RPC = 'https://forno.celo-sepolia.celo-testnet.org';
const ATTACKER = '0x000000000000000000000000000000000000b001';
const DELEGATE = '0x000000000000000000000000000000000000b002';
const FAKE_BALANCE = 10n ** 19n;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const address = value => {
  if (!/^0x[0-9a-f]{40}$/i.test(value)) throw new Error('Enter a valid smart-account address.');
  return value.toLowerCase();
};

export async function rpc(method, params = []) {
  const response = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) {
    const error = new Error(payload.error.message || 'RPC request failed');
    error.data = payload.error.data;
    throw error;
  }
  if (payload.result === undefined) throw new Error('RPC returned no result.');
  return payload.result;
}

export async function simulate(accountInput, fixture, report = () => {}, request = rpc) {
  const account = address(accountInput.trim());
  const s = fixture.selectors;
  if (BigInt(await request('eth_chainId')) !== 11142220n) throw new Error('RPC is not Celo Sepolia.');
  const block = await request('eth_blockNumber');
  const call = (to, data, overrides) => request('eth_call', [
    { from: ATTACKER, to, data, gas: '0x1e8480' }, block, ...(overrides ? [overrides] : []),
  ]);
  if ((await request('eth_getCode', [account, block])) === '0x') throw new Error('No contract at this address.');
  const decodeAddress = data => {
    if (!/^0x[0-9a-f]{64}$/i.test(data)) throw new Error('Unexpected contract response.');
    return address('0x' + data.slice(-40));
  };
  const owner = decodeAddress(await call(account, s['owner()']));
  const policy = decodeAddress(await call(account, s['policyManager()']));
  if (new Set([account, owner, policy, ATTACKER, DELEGATE]).size !== 5) throw new Error('Simulation address collision.');
  const originalOwnerCode = await request('eth_getCode', [owner, block]);
  const originalBalance = await request('eth_getBalance', [account, block]);
  const originalLimit = await call(policy, s['maxNativeTransfer()']);
  report('Account inspected', { account, owner, policy, block, limitWei: BigInt(originalLimit).toString() });

  const overrides = {
    [owner]: { code: '0xef0100' + DELEGATE.slice(2) },
    [DELEGATE]: { code: fixture.runtime },
    [account]: { balance: '0x' + FAKE_BALANCE.toString(16) },
  };
  // Require a working delegation control before interpreting any attack revert.
  const identity = decodeAddress(await call(owner, s['identity()'], overrides));
  if (identity !== owner) throw new Error('RPC did not execute the delegate in the owner context.');
  report('Delegation control passed', 'Temporary delegate executed as the owner; simulated account balance is 10 CELO.');

  const expected = s['DirectOwnerCallWithCode(address)'] + word(owner);
  const attack = async (label, data) => {
    try {
      await call(owner, data, overrides);
      report(label, 'NOT BLOCKED: simulated delegated call succeeded.');
      return { label, outcome: 'vulnerable' };
    } catch (error) {
      // Only the exact guard error counts. Generic reverts/RPC errors do not.
      const revertData = typeof error.data === 'string' ? error.data : error.data?.data;
      const blocked = typeof revertData === 'string' && revertData.toLowerCase() === expected;
      const result = { label, outcome: blocked ? 'blocked' : 'inconclusive', message: error.message, revertData };
      report(label, result);
      return result;
    }
  };
  const results = [];
  results.push(await attack('Raise limit and drain', s['takeOver(address,address)'] + word(account) + word(ATTACKER)));
  // A separate attack tests execution itself, without attempting a policy change.
  const executeData = s['execute(address,uint256,bytes)'] + word(ATTACKER) + word(0) + word(96) + word(0);
  const raw = executeData.slice(2);
  const forward = s['forward(address,bytes)'] + word(account) + word(64) + word(raw.length / 2) + raw.padEnd(Math.ceil(raw.length / 64) * 64, '0');
  results.push(await attack('Direct execution as delegated owner', forward));

  // Same block, without overrides: prove simulated state was not persisted.
  const unchanged = (await request('eth_getCode', [owner, block])) === originalOwnerCode
    && (await request('eth_getBalance', [account, block])) === originalBalance
    && (await call(policy, s['maxNativeTransfer()'])) === originalLimit;
  if (!unchanged) throw new Error('Could not confirm the unmodified RPC snapshot.');
  report('Original state verified', 'Owner code, account balance and policy limit are unchanged at the tested block.');
  return { account, owner, block, results, outcome: results.some(x => x.outcome === 'vulnerable') ? 'vulnerable'
    : results.every(x => x.outcome === 'blocked') ? 'blocked' : 'inconclusive' };
}
