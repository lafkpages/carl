import type { Client } from "whatsapp-web.js";
import type { Command, Plugin } from "./plugins";

import { consola } from "consola";
import { DepGraph } from "dependency-graph";

import { setPluginConfig } from "./config";
import { scanPlugins } from "./plugins";

export interface InternalCommand extends Command {
  _plugin: Plugin<string>;
}

export class PluginsManager implements Iterable<Plugin<string>> {
  private _loadedPlugins = new Map<string, Plugin<string>>();
  private _scannedPlugins = new Map<string, string>();
  private _commands = new Map<string, InternalCommand>();
  private client;

  constructor(client: Client) {
    this.client = client;
  }

  async scanPlugins() {
    await scanPlugins(this._scannedPlugins);
  }

  registerPlugin(plugin: Plugin<string>) {
    consola.debug("Registering plugin:", plugin.id);

    if (this._loadedPlugins.has(plugin.id)) {
      throw new Error(`Tried to load duplicate plugin: ${plugin.id}`);
    }

    if (plugin.depends) {
      for (const dependency of plugin.depends) {
        const dependencyPlugin = this._loadedPlugins.get(dependency);

        if (!dependencyPlugin) {
          throw new Error(
            `Plugin ${plugin.id} depends on plugin ${dependency} which is not loaded`,
          );
        }

        // @ts-expect-error - dependencies is private
        if (!plugin.dependencies) plugin.dependencies = {};
        // @ts-expect-error
        plugin.dependencies[dependency] = dependencyPlugin;
      }
    }

    // Set config before storing plugin because setPluginConfig
    // may throw an error if the config is invalid
    if (plugin.configSchema) {
      setPluginConfig(plugin.id, plugin.configSchema);
    }

    this._loadedPlugins.set(plugin.id, plugin);

    // @ts-expect-error - _commands is private so plugins don't access
    // each other's commands, but we need to access it here
    const { _commands } = plugin;

    for (const command of _commands) {
      if (this._commands.has(command.name)) {
        consola.error(
          `Skipping loading duplicate command: ${plugin.id}/${command.name}`,
        );
        continue;
      }

      this._commands.set(command.name, {
        ...command,
        _plugin: plugin,
      });
    }

    // @ts-expect-error - _client is private
    plugin._client = this.client;
  }

  async loadPlugin(pluginId: string) {
    consola.info("Loading plugin:", pluginId);

    const path = this._scannedPlugins.get(pluginId);

    if (!path) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const plugin: Plugin<string> = new (
      await import(`${path}?${Date.now()}`)
    ).default(this.client);

    if (plugin.id !== pluginId) {
      throw new Error(
        `Plugin ID mismatch: expected ${pluginId}, got ${plugin.id}`,
      );
    }

    return plugin;
  }

  async loadPlugins(pluginIds: Iterable<string>) {
    const graph = new DepGraph<Plugin<string>>();

    for (const pluginId of pluginIds) {
      const plugin = await this.loadPlugin(pluginId).catch(consola.error);

      if (!plugin) {
        continue;
      }

      graph.addNode(pluginId);
      graph.setNodeData(pluginId, plugin);

      if (plugin.depends) {
        for (const dependency of plugin.depends) {
          graph.addNode(dependency);
          graph.addDependency(pluginId, dependency);
        }
      }
    }

    for (const pluginId of graph.overallOrder()) {
      const plugin = graph.getNodeData(pluginId);

      try {
        this.registerPlugin(plugin);
      } catch (err) {
        consola.error(err);
      }
    }
  }

  getPlugin(pluginId: string) {
    return this._loadedPlugins.get(pluginId);
  }

  async unloadPlugin(pluginId: string, runUnloadCallback = true) {
    consola.info("Unloading plugin:", pluginId);

    const plugin = this._loadedPlugins.get(pluginId);

    if (!plugin) {
      throw new Error(`Plugin not loaded: ${pluginId}`);
    }

    if (runUnloadCallback) {
      await plugin.run("unload").catch(consola.error);
    }

    // @ts-expect-error - _db is private so plugins don't access
    // each other's databases, but we need to access it here
    const { _db } = plugin;

    _db?.close();
    // @ts-expect-error
    plugin._db = null;

    this._loadedPlugins.delete(pluginId);
  }

  getCommand(name: string) {
    return this._commands.get(name);
  }

  [Symbol.iterator] = this._loadedPlugins.values.bind(this._loadedPlugins);
}
