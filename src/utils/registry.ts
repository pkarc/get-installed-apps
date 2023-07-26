/************************************************************************************************************
 * registry.js - contains a wrapper for the REG command under Windows, which provides access to the registry
 */
const iconv = require("iconv-lite");
import * as path from 'path'
import * as util from 'util'
import { spawn } from 'child_process'
/* imports */
let log = function (info) {
  // console.log(info)
}

  /* registry hive ids */
  , HKLM = 'HKLM'
  , HKCU = 'HKCU'
  , HIVES = [HKLM, HKCU]

  /* general key pattern */
  , KEY_PATTERN = /(\\[a-zA-Z0-9_\s]+)*/

  /* key path pattern (as returned by REG-cli) */
  , PATH_PATTERN = /^(HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_CLASSES_ROOT|HKEY_USERS|HKEY_CURRENT_CONFIG)(.*)$/

  /* registry item pattern */
  , ITEM_PATTERN = /^(.*)\s(REG_SZ|REG_MULTI_SZ|REG_EXPAND_SZ|REG_DWORD|REG_QWORD|REG_BINARY|REG_NONE)\s+([^\s].*)$/

/**
 * Creates an Error object that contains the exit code of the REG.EXE process.
 * This contructor is private. Objects of this type are created internally and returned in the <code>err</code> parameters in case the REG.EXE process doesn't exit cleanly.
 *
 * @private
 * @class
 *
 * @param {string} message - the error message
 * @param {number} code - the process exit code
 *
 */

const ProcessEnv = process.env

/*
 * Captures stdout/stderr for a child process
 */
function captureOutput(child) {
  // Use a mutable data structure so we can append as we get new data and have
  // the calling context see the new data
  let output = { 'stdout': '', 'stderr': '' };

  child.stdout.on('data', function (data) { output["stdout"] += data.toString(); });
  child.stderr.on('data', function (data) { output["stderr"] += data.toString(); });

  return output;
}


/*
 * Returns an error message containing the stdout/stderr of the child process
 */
function mkErrorMsg(registryCommand, code, output) {
  let stdout = output['stdout'].trim();
  let stderr = output['stderr'].trim();

  let msg = util.format("%s command exited with code %d:\n%s\n%s", registryCommand, code, stdout, stderr);
  return null
  // return new ProcessUncleanExitError(msg, code);
}


/*
 * Converts x86/x64 to 32/64
 */
function convertArchString(archString) {
  if (archString == 'x64') {
    return '64';
  } else if (archString == 'x86') {
    return '32';
  } else {
    throw new Error('illegal architecture: ' + archString + ' (use x86 or x64)');
  }
}


/*
 * Adds correct architecture to reg args
 */
function pushArch(args, arch) {
  if (arch) {
    args.push('/reg:' + convertArchString(arch));
  }
}

/*
 * Get the path to system's reg.exe. Useful when another reg.exe is added to the PATH
 * Implemented only for Windows
 */
function getRegExePath() {
  if (process.platform === 'win32') {
    return path.join(ProcessEnv['windir'], 'system32', 'reg.exe');
  } else {
    return "REG";
  }
}

/**
 * Creates a registry object, which provides access to a single registry key.
 * Note: This class is returned by a call to ```require('winreg')```.
 *
 * @public
 * @class
 *
 * @param {object} options - the options
 * @param {string=} options.host - the hostname
 * @param {string=} options.hive - the hive id
 * @param {string=} options.key - the registry key
 * @param {string=} options.arch - the optional registry hive architecture ('x86' or 'x64'; only valid on Windows 64 Bit Operating Systems)
 *
 * @example
 * let Registry = require('winreg')
 * ,   autoStartCurrentUser = new Registry({
 *       hive: Registry.HKCU,
 *       key:  '\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
 *     });
 *
 */
export function Registry(options):void {

  if (!(this instanceof Registry))
    return new Registry(options);

  /* private members */
  let _options = options || {}
    , _host = '' + (_options.host || '')    // hostname
    , _hive = '' + (_options.hive || HKLM)  // registry hive
    , _key = '' + (_options.key || '')    // registry key
    , _arch = _options.arch || null         // hive architecture

  /* getters/setters */

  /**
   * The hostname.
   * @readonly
   * @member {string} Registry#host
   */
  this.__defineGetter__('host', function () { return _host; });

  /**
   * The hive id.
   * @readonly
   * @member {string} Registry#hive
   */
  this.__defineGetter__('hive', function () { return _hive; });

  /**
   * The registry key name.
   * @readonly
   * @member {string} Registry#key
   */
  this.__defineGetter__('key', function () { return _key; });

  /**
   * The full path to the registry key.
   * @readonly
   * @member {string} Registry#path
   */
  this.__defineGetter__('path', function () { return (_host.length == 0 ? '' : '\\\\' + _host + '\\') + _hive + _key; });

  /**
   * The registry hive architecture ('x86' or 'x64').
   * @readonly
   * @member {string} Registry#arch
   */
  this.__defineGetter__('arch', function () { return _arch; });

  /**
   * Creates a new {@link Registry} instance that points to the parent registry key.
   * @readonly
   * @member {Registry} Registry#parent
   */
  this.__defineGetter__('parent', function () {
    let i = _key.lastIndexOf('\\')
    return new Registry({
      host: this.host,
      hive: this.hive,
      key: (i == -1) ? '' : _key.substring(0, i),
      arch: this.arch
    });
  });

  // validate options...
  if (HIVES.indexOf(_hive) == -1)
    throw new Error('illegal hive specified.');

  if (!KEY_PATTERN.test(_key))
    throw new Error('illegal key specified.');

  if (_arch && _arch != 'x64' && _arch != 'x86')
    throw new Error('illegal architecture specified (use x86 or x64)');

}

/**
 * Registry hive key HKEY_LOCAL_MACHINE.
 * Note: For writing to this hive your program has to run with admin privileges.
 * @type {string}
 */
Registry.HKLM = HKLM;

/**
 * Registry hive key HKEY_CURRENT_USER.
 * @type {string}
 */
Registry.HKCU = HKCU;

/**
 * Collection of available registry hive keys.
 * @type {array}
 */
Registry.HIVES = HIVES;

/**
 * Creates a single registry value record.
 * This contructor is private. Objects of this type are created internally and returned by methods of {@link Registry} objects.
 *
 * @private
 * @class
 *
 * @param {string} host - the hostname
 * @param {string} hive - the hive id
 * @param {string} key - the registry key
 * @param {string} name - the value name
 * @param {string} type - the value type
 * @param {string} value - the value
 * @param {string} arch - the hive architecture ('x86' or 'x64')
 *
 */
function RegistryItem(host, hive, key, name, type, value, arch):void {

  if (!(this instanceof RegistryItem))
    return new RegistryItem(host, hive, key, name, type, value, arch);

  /* private members */
  let _host = host    // hostname
      , _hive = hive    // registry hive
      , _key = key      // registry key
      , _name = name    // property name
      , _type = type    // property type
      , _value = value  // property value
      , _arch = arch    // hive architecture

  /* getters/setters */

  /**
   * The hostname.
   * @readonly
   * @member {string} RegistryItem#host
   */
  this.__defineGetter__('host', function () { return _host; });

  /**
   * The hive id.
   * @readonly
   * @member {string} RegistryItem#hive
   */
  this.__defineGetter__('hive', function () { return _hive; });

  /**
   * The registry key.
   * @readonly
   * @member {string} RegistryItem#key
   */
  this.__defineGetter__('key', function () { return _key; });

  /**
   * The value name.
   * @readonly
   * @member {string} RegistryItem#name
   */
  this.__defineGetter__('name', function () { return _name; });

  /**
   * The value type.
   * @readonly
   * @member {string} RegistryItem#type
   */
  this.__defineGetter__('type', function () { return _type; });

  /**
   * The value.
   * @readonly
   * @member {string} RegistryItem#value
   */
  this.__defineGetter__('value', function () { return _value; });

  /**
   * The hive architecture.
   * @readonly
   * @member {string} RegistryItem#arch
   */
  this.__defineGetter__('arch', function () { return _arch; });

}

util.inherits(RegistryItem, Object);

/**
 * Retrieve all values from this registry key.
 * @param {valuesCallback} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @param {array=} cb.items - an array of {@link RegistryItem} objects
 * @returns {Registry} this registry key object
 */
Registry.prototype.values = function values(cb) {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  let args = ['QUERY', this.path];

  pushArch(args, this.arch);

  let proc = spawn(getRegExePath(), args, {
    cwd: undefined,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
      , buffer = ''
      , self = this
      , error = null // null means no error previously reported.

  let output = captureOutput(proc);

  proc.on('close', function (code) {
    if (error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg('QUERY', code, output), null);
    } else {
      let items = []
          , result = []
          , lines = buffer.split('\n')
          , lineNumber = 0

      for (let i = 0, l = lines.length; i < l; i++) {
        let line = lines[i].trim();
        if (line.length > 0) {
          log(line);
          if (lineNumber != 0) {
            items.push(line);
          }
          ++lineNumber;
        }
      }

      for (let i = 0, l = items.length; i < l; i++) {

        let match = ITEM_PATTERN.exec(items[i])
            , name
            , type
            , value

        if (match) {
          name = match[1].trim();
          type = match[2].trim();
          value = match[3];
          result.push(new RegistryItem(self.host, self.hive, self.key, name, type, value, self.arch));
        }
      }

      cb(null, result);

    }
  });

  proc.stdout.on('data', function (data) {
    buffer += iconv.decode(data, "cp936");
  });

  proc.on('error', function (err) {
    error = err;
    cb(err);
  });

  return this;
};

/**
 * Retrieve all subkeys from this registry key.
 * @param {function (err, items)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @param {array=} cb.items - an array of {@link Registry} objects
 * @returns {Registry} this registry key object
 */
Registry.prototype.keys = function keys(cb) {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  let args = ['QUERY', this.path];

  pushArch(args, this.arch);

  let proc = spawn(getRegExePath(), args, {
    cwd: undefined,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
    , buffer = ''
    , self = this
    , error = null // null means no error previously reported.

  let output = captureOutput(proc);

  proc.on('close', function (code) {
    if (error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg('QUERY', code, output), null);
    }
  });

  proc.stdout.on('data', function (data) {
    buffer += data.toString();
  });

  proc.stdout.on('end', function () {

    let items = []
      , result = []
      , lines = buffer.split('\n')

    for (let i = 0, l = lines.length; i < l; i++) {
      let line = lines[i].trim();
      if (line.length > 0) {
        log(line);
        items.push(line);
      }
    }

    for (let i = 0, l = items.length; i < l; i++) {

      let match = PATH_PATTERN.exec(items[i])
        , hive
        , key

      if (match) {
        hive = match[1];
        key = match[2];
        if (key && (key !== self.key)) {
          result.push(new Registry({
            host: self.host,
            hive: self.hive,
            key: key,
            arch: self.arch
          }));
        }
      }
    }

    cb(null, result);

  });

  proc.on('error', function (err) {
    error = err;
    cb(err);
  });

  return this;
};

