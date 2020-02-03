[![Build Status](https://travis-ci.org/joeferner/node-java-maven.svg)](https://travis-ci.org/joeferner/node-java-maven)
[![npm version](https://badge.fury.io/js/node-java-maven.svg)](https://badge.fury.io/js/node-java-maven)

node-java-maven
---------------
从 node-java-maven改造而来， 删除了部分功能。
不会递归下载依赖。
直接依据metadata.xml下载最新的jar包

* Install node-java-maven

        npm install node-java-maven
        
* Add a java key to your package.json

```
  "java": {
    "repositories": [
      {
        "id": "maven-central",
        "url": "http://192.168.10.44:8081/nexus/content/repositories/public/",
        "credentials": {
          "username": "user",
          "password": "pass"
        }
      }
    ],
    "dependencies": [
      {
        "groupId": "nurse",
        "artifactId": "cdss-api",
        "version": "1.0.0-SNAPSHOT"
      }
    ],
    "localRepository": "file"
  },
```
        
        
* Run node-java-maven

        ./node_modules/.bin/node-java-maven
        
* 在下载完成后进行其他操作

        var java = require('java');
        var mvn = require('node-java-maven');

        mvn(function(err, mvnResults) {
          if (err) {
            return console.error('could not resolve maven dependencies', err);
          }
          // do something
        });
        
* dist下的index可以复制之后直接使用。
