export const getTokenInfoByAddress = async (address: string, coinmarketcapApiKey: string): Promise<any | null> => {
  const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?address=${address}`;

  const response = await fetch(url, {
    headers: { "X-CMC_PRO_API_KEY": coinmarketcapApiKey },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch token info: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.status.error_code !== 0) {
    throw new Error("Coinmarketcap error:", data.status.error_message);
  }

  const id = Object.keys(data.data)[0];
  return id;
};

export const getTokenPriceUSDById = async (id: number, coinmarketcapApiKey: string): Promise<number> => {
  const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${id}`;

  const res = await fetch(url, {
    headers: { "X-CMC_PRO_API_KEY": coinmarketcapApiKey },
  });

  const data = await res.json();

  if (data.status.error_code !== 0) {
    throw new Error("Coinmarketcap error:", data.status.error_message);
  }

  return data.data[id].quote.USD.price;
};

export const calculateTokenAmount = (
  ethFee: string,
  ethPriceUSD: string,
  tokenPriceUSD: string
): string => {
  const ethFeeUSD = (parseFloat(ethFee) * parseFloat(ethPriceUSD)).toString();

  const tokensNeeded = (
    parseFloat(ethFeeUSD) / parseFloat(tokenPriceUSD)
  ).toString();

  return tokensNeeded;
};