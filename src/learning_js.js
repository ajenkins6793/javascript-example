const YAML = require('js-yaml')
const { google } = require('googleapis')
const Compute = require('@google-cloud/compute')
const Storage = require('@google-cloud/storage')
const { pollFile } = require('../storage')
const { choice, randomBytes } = require('../../utilities')
// this is the same as saying const choice = require('../../utilities').choice;
//const randomBytes = require('../../utilities').randomBytes

/**
 * Create a string dictating the host config, as expected
 * by the compute engine REST API.
 *
 * @param {Integer} cores
 * @param {Integer} memory
 */

 // the @param tag let's you document the name, type and description of a function parameter
const createMachineType = function (cores, memory) {
  const mb = memory * 1024
  return `custom-${cores}-${mb}`
}

// uppercase variables are immutable - the value is fixed
const PREFIXES = [
  'bugsy',
  'imjacked',
  'atari',
  'nathan',
]

/**
 * Generate a random (enough to avoid collision) name for a machine instance.
 *
 * @returns {String}
 */
const createName = function (prefix) {
  if (prefix === undefined || prefix === null) { //=== means equal value AND type
    prefix = choice(PREFIXES)
  }

  const identifier = randomBytes(12, 'hex')
  return `${prefix}-${identifier.slice(0, 6)}`
}

module.exports.createName = createName

/**
 * Create's a container specification in the format expected
 * by the undocumented API for container deleclarations.
 *
 * NOTE: This content is serialized a YAML, and then embedded
 * into the instance creation (REST API) JSON payload.
 *
 * TODO(@axdg): Extend this to allow for `env` etc.
 *
 * @param {Object} options
 * @returns {Object}
 */
const createContainerSpec = function (options) {
  const {
    name,
    image,
    command,
    args,
    env,
  } = options

  const container = {
    name,
    image,
    securityContext: {
      privileged: true,
    },
    stdin: true,
    tty: true,
  }

  /**
   * NOTE: This allows for arguments to be passed as a single
   * string or an array of strings, without causing issue.
   */
  if (args !== undefined) {
    let _args // let used here has only block scope (inside the if block)
    if (Array.isArray(args) && args.length) _args = args.join(' ')
    if (typeof args === 'string') _args = args

    if (_args) {
      container.args = _args
      .split(' ')
      .map(v => String(v).trim()) // the arrow notaton is another way of writing function(v){return String(v).trim()}
      .filter(Boolean)
    }
  }

  /**
   * QUESTION: Do we need any additions to this sort of validation?
   */
  if (command !== undefined) container.command = command
  if (env !== undefined && args.length) container.env = env

  return {
    spec: {
      containers: [container],
      restartPolicy: 'Never',
    },
  }
}

/**
 * Creates the configuration required by the REST API for
 * instance creation (with a container).
 *
 * TODO: Extend this to be able to accept IPs in a
 * particular range (or without a blacklisted prefix).
 *
 * @param {Object} options
 * @returns {Object}
 */
const createConfig = function (options = {}) {
  const {
    projectId = 'insight-186822',
    zone = 'us-east1-b',
    prefix,
    name: _name,
    cores = 4,
    type,
    memory = 16,
    disk = 64,

    /**
     * NOTE: These are the container options...
     * they are passed direction to `createContainerSpec`
     */
    image = 'gcr.io/insight-186822/test-image',
    command,
    args,
    env,
  } = options

  const name = _name || createName(prefix)

  const zs = `projects/${projectId}/zones/${zone}`
  const region = zone.split('-').slice(0, 2).join('-')
  const rs = `projects/insight-186822/regions/${region}`
  const _type = type || createMachineType(cores, memory)

  const containerOptions = { name, image, command, args, env }
  const containerSpec = YAML.safeDump(createContainerSpec(containerOptions))

  return {
    kind: 'compute#instance',
    name,
    zone: zs,
    machineType: `${zs}/machineTypes/${_type}`,
    displayDevice: {
      enableDisplay: false,
    },
    metadata:
    {
      kind: 'compute#metadata',
      items: [
        {
          key: 'gce-container-declaration',
          value: containerSpec,
        },
        {
          key: 'google-logging-enabled',
          value: 'true',
        },
      ],
    },
    tags: {
      items: [
        'http-server',
        'https-server',
      ],
    },
    disks: [
      {
        kind: 'compute#attachedDisk',
        type: 'PERSISTENT',
        boot: true,
        mode: 'READ_WRITE',
        autoDelete: true,
        deviceName: name,
        initializeParams: {
          sourceImage: 'projects/cos-cloud/global/images/cos-stable-74-11895-86-0',
          diskType: `${zs}/diskTypes/pd-ssd`,
          diskSizeGb: disk.toString(),
        },
      },
    ],
    canIpForward: false,
    networkInterfaces: [
      {
        kind: 'compute#networkInterface',
        // TODO: It's possible that using this would prevent using zones.
        subnetwork: `${rs}/subnetworks/default`,
        accessConfigs: [
          {
            kind: 'compute#accessConfig',
            name: 'External NAT',
            type: 'ONE_TO_ONE_NAT',
            networkTier: 'PREMIUM',
          },
        ],
        aliasIpRanges: [],
      },
    ],
    description: '',
    labels: { 'container-vm': 'cos-stable-74-11895-86-0' },
    scheduling:
    {
      preemptible: false,
      onHostMaintenance: 'MIGRATE',
      automaticRestart: true,
      nodeAffinities: [],
    },
    deletionProtection: false,
    serviceAccounts: [
      { email: '146199470752-compute@developer.gserviceaccount.com',
        scopes: [
          'https://www.googleapis.com/auth/cloud-platform',
        ],
      },
    ],
  }
}

/**
 * Creates an instance (using the REST API) and returns
 * a `zone.vm` (Node.JS API)
 *
 * SEE: `// POST https://www.googleapis.com/compute/v1/projects/insight-186822/zones/us-east1-b/instances.insert`
 *
 * @param {Object}
 * @param {Object}
 * @returns {Object}
 */
const createInstance = async function (options = {}, _compute = null, _gclient = null) { // = null is the default value if these parameters are not passed
  const {
    projectId = 'insight-186822',
    zone = 'us-east1-b',
  } = options

  const auth = await google.auth.getClient({
    scopes: [
      'https://www.googleapis.com/auth/compute',
      'https://www.googleapis.com/auth/cloud-platform',
    ],
  })

  const gclient = _gclient || google.compute({ auth, version: 'v1' })
  const config = createConfig(options)

  const res = await gclient.instances.insert({
    project: projectId,
    zone,
    requestBody: config,
  })

  const compute = _compute || new Compute()

  return new Promise(function (resolve, reject) { // eslint-disable-line consistent-return
    try {
      const _zone = compute.zone(zone)
      const operation = _zone.operation(res.data.id)
      operation.on('error', function (err) {
        operation.removeAllListeners()
        reject(err)
      })

      operation.on('complete', async function (/** metadata */) {
        operation.removeAllListeners()
        try {
          const [machine] = await _zone.vm(config.name).get()
          return resolve(machine)
        } catch (err) {
          return reject(err)
        }
      })
    } catch (err) {
      return reject(err)
    }
  })
}

module.exports.createInstance = createInstance
module.exports.execContainer = createInstance

/**
 * Given the (unique) name of a machine / file in the `insights_ipc` bucket -
 * this will poll for the existence of a JSON file, and reeject or resolve
 * based on it's parsed contents.
 *
 * It's a trivial wrapper around the polling function exposed by the `./storage.js`.
 *
 * NOTE: As a general design pattern, machines which are started,
 * should (upon completion of whatever task they are supposed to accomplish)
 * write a file into to the `gs://insights_ipc` bucket using their own name
 * as the file name. This allows us to communicate and monitor for the
 * completion of the job, while guarenteeing that the same insatnce
 * that handled creation of the machine can handle steps which depend on it.
 *
 * @param {Object} machine
 * @param {Object} client
 * @returns {Object}
 */
const pollInstanceIPC = async function (machine, _bucket = null, client = null) {
  if (client === null) client = new Storage()

  if (_bucket === null) _bucket = 'insights_ipc'
  const _file = machine.name

  const bucket = client.bucket(_bucket)
  const file = await pollFile(bucket, _file) // TODO: Add ability to pass interval and timeout.

  if (file === null) throw new Error('Machine lifetime exceeded timeout, or some other error.')

  /**
   * NOTE: This IPC mechanism expects that the machine writes valid
   * JSON that is either `true` or an object with at least the top
   * level key `status` to communicate either success or failure.
   */
  const res = await file.download()

  const data = JSON.parse(res[0])
  if (data === true || (data.status && data.status === 'SUCCESS')) {
    return data
  }

  const err = new Error('IPC did not write `SUCCESS`')
  Object.assign(err, data)
  throw err
}

module.exports.pollInstanceIPC = pollInstanceIPC