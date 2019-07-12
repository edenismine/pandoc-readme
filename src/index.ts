import {Command, flags} from '@oclif/command'
import {exec} from 'child_process'
import fs from 'fs-extra'
import klawSync = require('klaw-sync')
import path from 'path'
import process from 'process'

// Some constants.
const CWD = process.cwd()
const SETTINGS_FILE_NAME = 'readme-settings.json'
const SETTINGS_FILE_PATH = path.resolve(CWD, SETTINGS_FILE_NAME)

/**
 * User settings.
 */
interface Settings {
  /**
   * Project name.
   */
  project: string
  /**
   * Path to header file.
   */
  header?: string
  /**
   * Path to source directory.
   */
  sourceDir?: string
  /**
   * Path to metadata file.
   */
  metadata?: string
  /**
   * Path to bib file.
   */
  bib?: string
  /**
   * Desired output file name.
   */
  output: string
  /**
   * Path to pandoc executable.
   */
  pandoc?: string
}

/**
 * Parameters used to run pandoc commands.
 */
interface PandocParameters {
  /**
   * Path to pandoc executable.
   */
  pandoc: string
  /**
   * Header parameter.
   */
  header?: string
  /**
   * Bibliography parameter.
   */
  bibliography?: string
  /**
   * Input parameter.
   */
  input: string
  /**
   * Output parameter.
   */
  output: string
}

class ReadmeUtils extends Command {
  static description =
    'A thin wrapper that enables external configuration for the pandoc command.'

  static flags = {
    build: flags.boolean({
      char: 'b',
      description: 'if the project should be built.',
      default: true,
    }),
    init: flags.boolean({
      char: 'i',
      description: 'generate starter project.',
      exclusive: ['build'],
    }),
    name: flags.string({
      char: 'n',
      description:
        'project name and folder, defaults to the current working directory.',
      dependsOn: ['init'],
      exclusive: ['build'],
    }),
  }

  async run() {
    const {flags} = this.parse(ReadmeUtils)
    if (flags.init) {
      await this.initRun(flags.name)
    } else if (flags.build) {
      await this.buildRun()
    }
  }

  private async initRun(name: string | undefined) {
    const projectDir = name ? name : CWD
    this.debug(`Attempting to create project inside the ${projectDir} folder`)
    // TODO: Verify directory exists, if it doesn't create it.
    await fs.ensureDir(projectDir)
    // TODO: Copy files to project folder
    await fs.copy(path.resolve(__dirname, '..', 'template'), projectDir)
    const settingsPath = path.resolve(projectDir, SETTINGS_FILE_NAME)
    const settings: Settings = await fs.readJSON(settingsPath)
    settings.project = path.basename(projectDir)
    await fs.writeJSON(settingsPath, settings)
    this.exit(0)
  }

  /**
   * Reads the project's settings.
   */
  private async readSettings() {
    this.debug('Reading settings...')
    // Check settings file exist
    const settingsExist = await fs.pathExists(SETTINGS_FILE_PATH)
    if (!settingsExist) {
      throw Error(`Missing settings file ${SETTINGS_FILE_PATH}.`)
    }
    // Read settings file
    const settingsData = await fs.readFile(SETTINGS_FILE_PATH)
    const settings: Settings = JSON.parse(settingsData.toString('utf8'))
    return settings
  }

  /**
   * Creates pandoc parameters from the specified settings.
   * @param settings Build settings.
   */
  private async buildParameters(settings: Settings) {
    this.debug('Creating pandoc parameters...')
    // Check if source directory was overrode, set default if it wasn't
    settings.sourceDir = settings.sourceDir ? settings.sourceDir : 'src'
    settings.sourceDir = path.resolve(CWD, settings.sourceDir)
    // Get all the input files
    const inputFiles = klawSync(settings.sourceDir, {nodir: true})
    // Check there's at least one input file
    if (inputFiles.length === 0) {
      throw Error('Empty source directory.')
    }
    // Create minimal pandoc parameters
    const pandoc = settings.pandoc ? settings.pandoc : 'pandoc'
    const input = inputFiles.map(s => path.relative(CWD, s.path)).join(' ')
    const output = `--output=${settings.output}`
    const parameters: PandocParameters = {
      input,
      pandoc,
      output,
    }
    // Check if metadata is specified and verifies it exists
    // if it does, update parameters
    if (settings.metadata) {
      parameters.input = `${settings.metadata} ${parameters.input}`
    }
    // Check if bibliography is specified and verifies it exists
    // if it does, update parameters
    if (settings.bib) {
      parameters.bibliography = `--bibliography=${settings.bib}`
    }
    // Check if header is specified and verifies it exists
    // if it does, update parameters
    if (settings.header) {
      parameters.header = `--include-in-header=${settings.header}`
    }
    return parameters
  }

  /**
   * Creates a pandoc build command with the specified parameters.
   * @param parameters pandoc parameters
   */
  private async buildCommand(parameters: PandocParameters) {
    const options = []
    if (parameters.bibliography) {
      options.push(parameters.bibliography)
    }
    if (parameters.header) {
      options.push(parameters.header)
    }
    options.push(parameters.input)
    options.push(parameters.output)
    return `${parameters.pandoc} ${options.join(' ')}`
  }

  /**
   * Reads user settings, constructs the corresponding pandoc command and builds the project.
   */
  private async buildRun() {
    const settings = await this.readSettings()
    const parameters = await this.buildParameters(settings)
    const pandoc = await this.buildCommand(parameters)
    this.log(`Running build command:\n> ${pandoc}`)
    exec(pandoc, (error, stdout, sterr) => {
      if (error) {
        const {code} = error
        if (code !== 0 && code !== undefined) {
          this.warn(`Received non-zero (${code}) exit status from pandoc.`)
          this.error(sterr.trim(), {code: code.toString(), exit: false})
        }
      } else if (stdout.length > 0) this.log(stdout)
    })
  }
}

export = ReadmeUtils
