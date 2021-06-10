const { SecretManagerServiceClient } = require('@google-cloud/secret-manager')

/**
 * This method that attempts to get the secret value from
 * Secret Manager. If this fails, it then attempts to read them from the envvars
 *
 * @returns {String} Credentials
 */
 const getCredentials = async function (client) {
    try {
      const key = 'projects/146199470752/secrets/VAULT_KEY/versions/latest'
      const secret = 'projects/146199470752/secrets/VAULT_SECRET/versions/latest'
      const [
        [keyResponse],
        [secretResponse],
      ] = await Promise.all([
        client.accessSecretVersion({ name: key }),
        client.accessSecretVersion({ name: secret }),
      ])
      const keyValue = keyResponse.payload.data.toString('utf8')
      const secretValue = secretResponse.payload.data.toString('utf8')
      return [keyValue, secretValue]
    } catch (error) {
      console.log(error) // eslint-disable-line no-console
      // Try just using env variables
      return [process.env.VAULT_KEY, process.env.VAULT_SECRET]
    }
  }

const secretClient = new SecretManagerServiceClient()


const newFunction = async function(){
  const [key, secret] = await getCredentials(secretClient)

  const fetch = require('node-fetch')
  const getClient = require('@raywhite/vault-client')
  const integratorClient = getClient({fetch, key, secret})

  const scope = 'property.read'

  const accountId = 629
  const client = integratorClient.withScope(scope, {accountId})

  const data = await client.properties.get({pagesize: 5})

  console.log(data)

}

newFunction();