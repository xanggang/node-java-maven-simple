'use strict';

var fs = require('fs');
var async = require('async');
var xml2js = require('xml2js');
var request = require('request');
var path = require('path');
var mkdirp = require('mkdirp');
var appRoot = require('app-root-path');
var Dependency = require('./lib/dependency');

/**
 option: {
  packageJsonPath: package地址
  repositories: 私有库地址
  localRepository： 下载的文件的路径
  concurrency： 下载的线程
 }
 * **/

module.exports = function () {
  var options;
  var callback;
  if (arguments.length == 1) {
    options = {};
    callback = arguments[0];
  } else if (arguments.length == 2) {
    options = arguments[0];
    callback = arguments[1];
  } else {
    throw new Error('Expected 1 or 2 arguments not ' + arguments.length);
  }

  options = options || {};
  options.packageJsonPath = options.packageJsonPath || 'package.json';
  options.repositories = options.repositories || [
    {
      id: 'maven-central',
      url: 'http://192.168.10.44:8081/nexus/content/repositories/public/cc/ewell/'
    }
  ];
  options.localRepository = options.localRepository || path.join(getUserHome(), '.m2/repository');
  options.concurrency = options.concurrency || 1;

  var dependencies = {};
  var exclusions = [];
  var errors = [];

  var dependencyQueue = async.queue(processDependency, options.concurrency);
  dependencyQueue.drain = complete;

  return go(callback);

  function go(callback) {
    return readPackageJson(function(err, packageJson) {
      if (err) {
        return callback(err);
      }

      if (packageJson.java.repositories) {
        options.repositories = options.repositories.concat(packageJson.java.repositories);
      }

      if (!packageJson.java.dependencies) {
        return callback(new Error("Could not find java.dependencies property in package.json"));
      }

      if (!(packageJson.java.dependencies instanceof Array)) {
        return callback(new Error("java.dependencies property in package.json must be an array."));
      }

      if (packageJson.java.exclusions) {
        if (!(packageJson.java.exclusions instanceof Array)) {
          return callback(new Error("java.exclusions property in package.json must be an array."));
        } else {
          exclusions = packageJson.java.exclusions;
        }
      }

      if (packageJson.java.localRepository) {
        options.localRepository = path.join(appRoot.path, packageJson.java.localRepository);
      }
      return packageJson.java.dependencies.forEach(function(d) {
        // 在队列中添加上下文
        console.log('在队列中添加上下文， 下载' + d.groupId + d.artifactId)
        dependencyQueuePush(Dependency.createFromObject(d, 'package.json'));
      });
    });
  }

  // 下载之后编译
  function complete() {
    debug("COMPLETE");
    if (errors.length > 0) {
      return callback(errors);
    }
    var classpath = getClasspathFromDependencies(dependencies);
    return callback(null, {
      classpath: classpath,
      dependencies: dependencies
    });
  }

  // 读取package里面的配置文件
  function readPackageJson(callback) {
    return fs.readFile(options.packageJsonPath, 'utf8', function(err, packageJsonString) {
      if (err) {
        return callback(err);
      }
      try {
        var packageJson = JSON.parse(packageJsonString);
      } catch (ex) {
        return callback(ex);
      }

      if (!packageJson.java) {
        return callback(new Error("Could not find java property in package.json"));
      }

      return callback(null, packageJson);
    });
  }

  // 获取默认的下载地址
  function getUserHome() {
    return process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
  }

  // 向队列里添加方法
  function dependencyQueuePush(dependency, callback) {
    var dependencyArray = dependency;
    if (!(dependencyArray instanceof Array)) {
      dependencyArray = [dependency];
    }
    dependencyArray.forEach(function(d) {
      d.state = 'queued';

      if (!d.groupId) {
        throw new Error('missing required field [groupId] for queue: ' + d.toString());
      }
      if (!d.artifactId) {
        throw new Error('missing required field [artifactId] for queue: ' + d.toString());
      }
      if (!d.version) {
        throw new Error('missing required field [version] for queue: ' + d.toString());
      }
    });

    return dependencyQueue.push(dependency, callback);
  }

  // 开启一个线程进行下载
  function processDependency(dependency, callback) {
    return resolveDependency(dependency, function(err) {
      dependency.markCompleted();
      if (err) {
        errors.push(err);
      }
      var c = callback;
      callback = function() {};
      return c();
    });
  }

  // 下载metadata文件
  function resolveMetadata(dependency, callback) {
    var metadataPath = path.resolve(options.localRepository, dependency.getMetadata());

    return download(dependency, metadataPath, callback);

    // 组装和下载metadata文件
    function download(dependency, metadataPath, callback) {
      console.log('下载metadata');
      return downloadFile(dependency.getMetadata(), metadataPath, dependency.reason, function(err, url) {
        if (err) {
          console.log('下载metadata失败');
          return callback(err);
        }
        console.log('下载metadata成功');
        dependency.metadataUrl = url
        return readFile(dependency, metadataPath, callback);
      });
    }

    function readFile(dependency, metadataPath, callback) {
      dependency.metadataPath = metadataPath;
      return fs.readFile(metadataPath, 'utf8', function(err, data) {
        if (err) {
          return callback(err);
        }
        return loadFile(dependency, data, callback);
      });
    }

    function loadFile(dependency, data, callback) {
      xml2js.parseString(data, function(err, xml) {
        if (err) {
          return callback(err);
        }
        dependency.metadataXml = xml;
        return callback(null, xml);
      });
    }
  } // END resolvePom

  // 处理一个指定的jar包
  function resolveDependency(dependency, callback) {
    var existingDependency = dependencies[dependency.toString()];
    if (existingDependency) {
      dependency.state = 'waitUntilComplete';
      return existingDependency.waitUntilComplete(callback);
    }
    dependencies[dependency.toString()] = dependency;
    console.log('记录当前处理的jar包:' + dependency.toString());
    dependency.state = 'resolvePom';

    // 读取metadata文件
    return resolveMetadata(dependency, function(err) {
      if (err) {
        return callback(err);
      }
      return processJar(dependency, callback);
    });

    // 更改状态 下载jar包
    function processJar(dependency, callback) {
      dependency.state = 'processJar';
      return resolveJar(dependency, function(err) {
        if (err) {
          return callback(err);
        }
        callback()
      });
    }

  }

  // 下载jar包
  function resolveJar(dependency, callback) {
    var jarPath = path.resolve(options.localRepository, dependency.getLastJarPath());
    return fs.exists(jarPath, function(exists) {
      if (exists) {
        dependency.jarPath = jarPath;
        return callback();
      } else {
        return downloadFile(dependency.getLastJarPath(), jarPath, dependency.reason, function(err, url) {
          if (err) {
            return callback(err);
          }
          dependency.jarUrl = url;
          dependency.jarPath = jarPath;
          return callback();
        });
      }
    });
  }

  // 下载的方法
  function downloadFile(urlPath, destinationFile, reason, callback) {
    var repositoryIndex = 0;

    return mkdirp(path.dirname(destinationFile), function(err) {
      if (err) {
        console.log('文件夹创建失败');
        return callback(err);
      }

      var error = null;
      var foundUrl = null;
      return async.whilst(
        function() { return (repositoryIndex < options.repositories.length) && !foundUrl; },
        function(callback) {
          var repository = options.repositories[repositoryIndex];
          var url = repository.url + urlPath;
          var req_options = { url: url };

          if (repository.hasOwnProperty('credentials')) {
            var username = repository.credentials.username;
            var password = repository.credentials.password;
            req_options = {
              url: url,
              auth: {
                user: username,
                password: password
              }
            };
          }
          debug('downloading ' + url);
          console.log('文件下载地址:'+ url);
          var r = request(req_options);
          r.on('response', function(response) {
            if (response.statusCode != 200) {
              error = new Error('download failed for ' + url + (reason ? ' (' + reason + ')' : '') + ' [status: ' + response.statusCode + ']');
              return callback();
            } else {
              var out = fs.createWriteStream(destinationFile);
              out.on('finish', function() {
                foundUrl = url;
                console.log('文件下载完成');
                return callback();
              });
              out.on('error', function(err) {
                return callback();
              });
              return r.pipe(out);
            }
          });
          repositoryIndex++;
        },
        function() {
          if (foundUrl) {
            return callback(null, foundUrl);
          }
          return callback(error);
        }
      );
    });
  }

  function debug() {
    if (options.debug) {
      console.log.apply(console, arguments);
    }
  }

  function getClasspathFromDependencies(dependencies) {
    return Object.keys(dependencies)
      .map(function(depName) {
        return dependencies[depName].jarPath;
      })
      .filter(function(p) {
        return p;
      });
  }

}
