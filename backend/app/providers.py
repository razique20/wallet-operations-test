import os

class MockLLM:
    def answer(self, question: str, context: str):
        if os.getenv('MOCK_LLM_FAIL') == '1':
            raise TimeoutError('simulated model timeout')
        return f'Based on the supplied information: {context}'

class MockChain:
    TXS = {
        '0xgood': {'network': 'ethereum', 'token': 'USDT', 'to': '0xmerchant', 'amount': '50.00', 'confirmations': 15, 'success': True},
        '0xwrongtoken': {'network': 'ethereum', 'token': 'FAKE', 'to': '0xmerchant', 'amount': '50.00', 'confirmations': 15, 'success': True},
        '0xwrongaddress': {'network': 'ethereum', 'token': 'USDT', 'to': '0xattacker', 'amount': '50.00', 'confirmations': 15, 'success': True},
        '0xunconfirmed': {'network': 'ethereum', 'token': 'USDT', 'to': '0xmerchant', 'amount': '50.00', 'confirmations': 0, 'success': True},
        '0xfailed': {'network': 'ethereum', 'token': 'USDT', 'to': '0xmerchant', 'amount': '50.00', 'confirmations': 20, 'success': False},
    }
    def lookup(self, tx_hash: str):
        if os.getenv('MOCK_CHAIN_FAIL') == '1':
            raise ConnectionError('simulated RPC outage')
        return self.TXS.get(tx_hash)
