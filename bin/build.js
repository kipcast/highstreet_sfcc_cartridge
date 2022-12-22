#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const argv = require("yargs")
  .options({
    config: {
      alias: "c",
      describe: "provide a path to file",
      default: "./configuration.json"
    }
  })
  .help().argv;

// load config file
const configFile = path.join(process.cwd(), argv.config);
if (!fs.existsSync(configFile)) {
  console.log(`Error: file ${configFile} not found`);
  process.exit(1);
}
const config = require(configFile);

if (config.feeds) {
  const pug = require("pug");
  // compile pug templates
  const jobsTpl = pug.compileFile(__dirname + "/_templates/jobs.pug", {
    pretty: true
  });
  const servicesTpl = pug.compileFile(__dirname + "/_templates/services.pug", {
    pretty: true
  });

  let data = {
    catalogs: {
      length: 0
    },
    priceBooks: {
      length: 0
    },
    inventoryLists: {
      length: 0
    },
    promotions: {
      length: 0
    }
  };

  config.feeds.map(feed => {
    let publishGroup = feed.publishGroup || "default";
    let site = feed.site;
    let locales = feed.locales;
    let imageViewType = feed.imageViewType || "large";
    if (feed.catalogMaster) {
      if (
        !(publishGroup in data.catalogs) ||
        data.catalogs[publishGroup]
          .map(catalog => catalog.id)
          .indexOf(feed.catalogMaster) < 0
      ) {
        data.catalogs[publishGroup] = (
          data.catalogs[publishGroup] || []
        ).concat({
          sites: [
            { site: site, locales: locales, imageViewType: imageViewType }
          ],
          id: feed.catalogMaster,
          master: true
        });
        data.catalogs.length++;
      } else {
        data.catalogs[publishGroup]
          .filter(catalog => catalog.id == feed.catalogMaster)
          .forEach(catalog =>
            catalog.sites.push({
              site: site,
              locales: locales,
              imageViewType: imageViewType
            })
          );
      }
    }
    if (feed.catalogStorefront) {
      if (
        !(publishGroup in data.catalogs) ||
        data.catalogs[publishGroup]
          .map(catalog => catalog.id)
          .indexOf(feed.catalogStorefront) < 0
      ) {
        data.catalogs[publishGroup] = (
          data.catalogs[publishGroup] || []
        ).concat({
          sites: [
            { site: site, locales: locales, imageViewType: imageViewType }
          ],
          id: feed.catalogStorefront,
          master: false
        });
        data.catalogs.length++;
      } else {
        data.catalogs[publishGroup]
          .filter(catalog => catalog.id == feed.catalogStorefront)
          .forEach(catalog =>
            catalog.sites.push({
              site: site,
              locales: locales,
              imageViewType: imageViewType
            })
          );
      }
    }

    []
      .concat(
        feed.priceBooks || [],
        feed.priceBooksSale || [],
        feed.priceBook || [],
        feed.priceBookSale || []
      )
      .forEach(priceBookID => {
        if (
          !(
            publishGroup in data.priceBooks &&
            data.priceBooks[publishGroup].find(
              priceBook => priceBook.id === priceBookID
            )
          )
        ) {
          data.priceBooks[publishGroup] = (
            data.priceBooks[publishGroup] || []
          ).concat({
            sites: [site],
            id: priceBookID
          });
          data.priceBooks.length++;
        } else {
          data.priceBooks[publishGroup]
            .filter(priceBook => priceBook.id == priceBookID)
            .forEach(priceBook => priceBook.sites.push(site));
        }
      });

    if (feed.inventoryList) {
      if (
        !(publishGroup in data.inventoryLists) ||
        data.inventoryLists[publishGroup].indexOf(feed.inventoryList) < 0
      ) {
        data.inventoryLists[publishGroup] = (
          data.inventoryLists[publishGroup] || []
        ).concat({
          sites: [site],
          id: feed.inventoryList
        });
        data.inventoryLists.length++;
      } else {
        data.inventoryLists[publishGroup]
          .filter(inventoryList => inventoryList.id == feed.inventoryList)
          .forEach(inventoryList => inventoryList.sites.push(site));
      }
    }

    if (
      feed.exportPromotions &&
      (!(publishGroup in data.promotions) ||
        data.promotions[publishGroup].indexOf(feed.site) < 0)
    ) {
      data.promotions[publishGroup] = (
        data.promotions[publishGroup] || []
      ).concat(feed.site);
      data.promotions.length++;
    }
  });

  config.exportFromEnv = {
    ...{
      production: ["inventoryLists"],
      staging: ["catalogs", "priceBooks", "promotions"],
      development: ["inventoryLists", "catalogs", "priceBooks", "promotions"]
    },
    ...config.exportFromEnv
  };
  config.id = config.id || path.parse(configFile).name;

  const outputFolder = path.join(process.cwd(), "import");
  if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder);

  Object.keys(config.exportFromEnv)
    .filter(env =>
      config.exportFromEnv[env].find(objectType => data[objectType].length)
    )
    .map(env => {
      // console.log(env)
      config.env = env;
      let ctx = Object.keys(data)
        .filter(
          objectType =>
            config.exportFromEnv[env].indexOf(objectType) >= 0 &&
            data[objectType].length
        )
        .reduce((acc, objectType) => {
          acc[objectType] = Object.assign({}, data[objectType]);
          delete acc[objectType].length;
          return acc;
        }, {});

      console.log(env, ctx);

      let jobsXml = jobsTpl({
        ...ctx,
        config: config,
        slugify: require("slugify")
      });

      fs.writeFileSync(
        path.join(outputFolder, `highstreet_jobs_${env}_${config.id}.xml`),
        jobsXml
      );

      if ("ftp" in config) {
        let servicesXml = servicesTpl({
          config: config
        });

        fs.writeFileSync(
          path.join(
            outputFolder,
            `highstreet_services_${env}_${config.id}.xml`
          ),
          servicesXml
        );
      }
    });
}
