/* eslint-disable consistent-return */
/* eslint-disable no-unused-vars */
/**
 * @module cartridge/scripts/productsFeed This module provides the job step that creates the feed for exporting the storefront urls for products and their images
 */

var log = require('dw/system/Logger').getLogger('highstreet');
var CatalogMgr = require('dw/catalog/CatalogMgr');
var File = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');
var ProductSearchModel = require('dw/catalog/ProductSearchModel');
var Site = require('dw/system/Site');
var URLAction = require('dw/web/URLAction');
var URLParameter = require('dw/web/URLParameter');
var URLUtils = require('dw/web/URLUtils');
var XMLIndentingStreamWriter = require('dw/io/XMLIndentingStreamWriter');
var ProductMgr = require('dw/catalog/ProductMgr');

var hits;
var fileWriter;
var xmlStreamWriter;
var locales;
var totalCount;
var site;
var processProductScript;

/**
 * Creates all the folders in the file path
 * @param {dw.io.File} file file
 */
function createFileAndFolders(file) {
    var path = file.fullPath.split(File.SEPARATOR);

    path.pop();
    var folder = new File(path.join(File.SEPARATOR));

    if (!folder.exists()) {
        folder.mkdirs();
    }

    if (!file.exists()) {
        file.createNewFile();
    }
}

/**
 * Executed before step:
 * - initialize the product search
 * - open the xml output file
 * @param {Object} parameters job step parameters
 * @param {Object} stepExecution step execution context
 */
exports.beforeStep = function (parameters, stepExecution) {
    log.info(
        'Starting the export of products urls and images from {0} to highstreet.io',
        parameters.CatalogID
    );

    var fileName = [
        File.IMPEX,
        parameters.TargetFolder,
        parameters.Filename
    ].join(File.SEPARATOR);
    var xmlFile = new File(fileName);
    createFileAndFolders(xmlFile);
    fileWriter = new FileWriter(xmlFile);
    xmlStreamWriter = new XMLIndentingStreamWriter(fileWriter);

    if (parameters.ProcessProductScript) {
        try {
            processProductScript = require(parameters.ProcessProductScript);
        } catch (e) {
            log.warn(
                'Error loading script {0}: {1}',
                parameters.ProcessProductScript,
                e.message
            );
        }
    }

    var catalog = CatalogMgr.getCatalog(parameters.CatalogID);

    if (parameters.useProductQuery) {
        hits = ProductMgr.queryProductsInCatalog(catalog);
        totalCount = hits.getCount();
    } else {
        var productSearchModel = new ProductSearchModel();
        productSearchModel.setRecursiveCategorySearch(true);
        productSearchModel.setOrderableProductsOnly(false);
        productSearchModel.setCategoryID(catalog.root.ID);
        if (processProductScript && processProductScript.prepareSearch) {
            processProductScript.prepareSearch(
                xmlStreamWriter,
                productSearchModel,
                parameters,
                stepExecution
            );
        }
        productSearchModel.search();
        totalCount = productSearchModel.getCount();

        hits = productSearchModel.getProductSearchHits();
    }
    locales = (parameters.SiteLocalesConfiguration || 'default')
        .split(',')
        .map(function (locale) {
            return locale.trim();
        });
    log.info(
        'Exporting {0} products urls and images in {1} locales',
        totalCount,
        locales.length
    );

    site = Site.current;

    xmlStreamWriter.writeStartDocument();
    xmlStreamWriter.writeStartElement('productsFeed');
    xmlStreamWriter.writeAttribute('catalog-id', parameters.CatalogID);
};

/**
 * Get the total count of items to be processed by the job step
 * @returns the total count of items to be processed by the job step
 */
// eslint-disable-next-line no-unused-vars
exports.getTotalCount = function (parameters, stepExecution) {
    return totalCount;
};

/**
 * Get the next element to be processed
 * @param {*} parameters job parameters
 * @param {*} stepExecution step execution informations
 * @returns {*} the next element to be processed
 */
exports.read = function (parameters, stepExecution) {
    if (hits.hasNext()) {
        return hits.next();
    }
};

exports.beforeChunk = function (parameters) {
    return;
};

exports.afterChunk = function (parameters) {
    return;
};

/**
 * Transform the element to be processed
 * @param {dw.catalog.ProductSearchHit} hit product search hit
 * @param {*} parameters job step parameters
 * @param {*} stepExecution step execution info
 * @returns {*} a processed object
 */
exports.process = function (hit, parameters, stepExecution) {
    if (processProductScript && processProductScript.processHit) {
        return processProductScript.processHit(hit, parameters, stepExecution);
    }
    return hit;
};

/**
 * Write a bunch of processed objects to the output file
 * @param {dw.util.Collection} hitsList list of hits to be written to the file
 * @param {Object} parameters job step parameters
 * @param {Object} stepExecution step execution context
 */
exports.write = function (hitsList, parameters, stepExecution) {
    var isProductSearch = !parameters.useProductQuery;

    if (processProductScript && processProductScript.write) {
        processProductScript.write(
            xmlStreamWriter,
            hitsList,
            parameters,
            stepExecution
        );
    } else {
        hitsList.toArray().forEach(function (hit) {
            if (processProductScript && processProductScript.writeHit) {
                processProductScript.writeHit(
                    xmlStreamWriter,
                    hit,
                    parameters,
                    stepExecution
                );
            } else {
                if (isProductSearch) {
                    var products = hit.product.isVariant() ? [hit.product] :
                        hit.representedProducts.toArray();
                } else {
                    var products = hit.isMaster() ? hit.variants.toArray() :
                        hit.isVariationGroup() ? [] : [hit];
                }
                products.forEach(function (product) {
                    if (isProductSearch || (product.searchable && product.online && hasCategory(product))) {
                        log.info('Processing product {0}', product.ID);
                        if (processProductScript && processProductScript.writeProduct) {
                            processProductScript.writeProduct(
                                xmlStreamWriter,
                                product,
                                parameters,
                                stepExecution
                            );
                        } else {
                            xmlStreamWriter.writeStartElement('product');
                            xmlStreamWriter.writeAttribute('id', product.ID);

                            xmlStreamWriter.writeStartElement('urls');
                            locales.forEach(function (locale) {
                                if (
                                    processProductScript &&
                                    processProductScript.writeProductUrl
                                ) {
                                    processProductScript.writeProductUrl(
                                        xmlStreamWriter,
                                        product,
                                        locale,
                                        parameters,
                                        stepExecution
                                    );
                                } else {
                                    xmlStreamWriter.writeStartElement('url');
                                    xmlStreamWriter.writeAttribute('locale', locale);
                                    var productUrl;
                                    if (
                                        processProductScript &&
                                        processProductScript.getProductUrl()
                                    ) {
                                        productUrl = processProductScript.getProductUrl(
                                            product,
                                            locale,
                                            parameters,
                                            stepExecution
                                        );
                                    } else {
                                        productUrl = URLUtils.abs(
                                            new URLAction('Product-Show', site.ID, locale),
                                            new URLParameter('pid', product.ID)
                                        );
                                    }
                                    xmlStreamWriter.writeCharacters(productUrl);
                                    xmlStreamWriter.writeEndElement(); // url
                                }
                            });
                            xmlStreamWriter.writeEndElement(); // urls

                            xmlStreamWriter.writeStartElement('images');
                            xmlStreamWriter.writeAttribute(
                                'view-type',
                                parameters.ImageViewType
                            );
                            product
                                .getImages(parameters.ImageViewType)
                                .toArray()
                                .forEach(function (image, index) {
                                    if (
                                        processProductScript &&
                                        processProductScript.writeProductImage
                                    ) {
                                        processProductScript.writeProductImage(
                                            xmlStreamWriter,
                                            product,
                                            image,
                                            index,
                                            parameters,
                                            stepExecution
                                        );
                                    } else {
                                        xmlStreamWriter.writeStartElement('image');
                                        xmlStreamWriter.writeAttribute('index', index);
                                        var imageUrl;
                                        if (
                                            processProductScript &&
                                            processProductScript.getProductImageUrl()
                                        ) {
                                            imageUrl = processProductScript.getProductImageUrl(
                                                product,
                                                image,
                                                index,
                                                parameters,
                                                stepExecution
                                            );
                                        } else {
                                            imageUrl = image.absURL.toString();
                                        }
                                        xmlStreamWriter.writeCharacters(imageUrl);
                                        xmlStreamWriter.writeEndElement(); // image
                                    }
                                });
                            xmlStreamWriter.writeEndElement(); // images

                            xmlStreamWriter.writeEndElement(); // product
                        }
                    }
                });
            }
        });
    }
};


function hasCategory(product) {
    var hasCategory = product.categories.length > 0;

    if (product.isVariant()) {
        hasCategory = product.categories.length > 0 ||
            product.masterProduct.categories.length > 0 ?
            true : false;
    }

    return hasCategory;
}
/**
 * Executed at the end of the step:
 * - close the xml file
 * @param {*} success success
 * @param {*} parameters parameters
 * @param {*} stepExecution step execution
 */
exports.afterStep = function (success, parameters, stepExecution) {
    xmlStreamWriter.writeEndElement();
    xmlStreamWriter.writeEndDocument();
    xmlStreamWriter.close();
    fileWriter.close();
    log.info('Finished');
};