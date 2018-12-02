'use strict'

const before = require('mocha').before
const describe = require('mocha').describe
const exec = require('child_process').exec
const expect = require('chai').expect
const fs = require('fs-extra')
const it = require('mocha').it
const jo = require('../src/main.js')
const jpegjs = require('jpeg-js')
const path = require('path')
const piexif = require('piexifjs')
const pixelmatch = require('pixelmatch')
const PNG = require('pngjs').PNG

const tmp_path = path.join(__dirname, '.tmp')

require('chai').should()

describe('jpeg-autorotate', function() {
  before(function() {
    return fs.emptyDir(tmp_path)
  })
  itShouldTransform(path.join(__dirname, '/samples/image_2.jpg'), 'image_2.jpg')
  itShouldTransform(path.join(__dirname, '/samples/image_3.jpg'), 'image_3.jpg')
  itShouldTransform(path.join(__dirname, '/samples/image_4.jpg'), 'image_4.jpg')
  itShouldTransform(path.join(__dirname, '/samples/image_5.jpg'), 'image_5.jpg')
  itShouldTransform(path.join(__dirname, '/samples/image_6.jpg'), 'image_6.jpg')
  itShouldTransform(path.join(__dirname, '/samples/image_7.jpg'), 'image_7.jpg')
  itShouldTransform(path.join(__dirname, '/samples/image_8.jpg'), 'image_8.jpg')
  itShouldTransform(path.join(__dirname, '/samples/image_exif.jpg'), 'image_exif.jpg')
  itShouldTransform(fs.readFileSync(path.join(__dirname, '/samples/image_8.jpg')), 'From a buffer')

  it('Should return an error if the orientation is 1', function(done) {
    jo.rotate(path.join(__dirname, '/samples/image_1.jpg'), {}, function(error, buffer) {
      error.should.have.property('code').equal(jo.errors.correct_orientation)
      Buffer.isBuffer(buffer).should.be.ok
      done()
    })
  })

  it('Should return an error if the image does not exist', function(done) {
    jo.rotate('foo.jpg', {}, function(error, buffer, orientation) {
      error.should.have.property('code').equal(jo.errors.read_file)
      expect(buffer).to.equal(null)
      expect(orientation).to.equal(null)
      done()
    })
  })

  it('Should return an error if the file is not an image', function(done) {
    jo.rotate(path.join(__dirname, '/samples/textfile.md'), {}, function(error, buffer, orientation) {
      error.should.have.property('code').equal(jo.errors.read_exif)
      expect(buffer).to.equal(null)
      expect(orientation).to.equal(null)
      done()
    })
  })

  it('Should return an error if the path is not a string/buffer', function(done) {
    jo.rotate(['foo'], {}, function(error, buffer, orientation) {
      error.should.have.property('code').equal(jo.errors.read_file)
      expect(buffer).to.equal(null)
      expect(orientation).to.equal(null)
      done()
    })
  })

  it('Should work if `options` is not an object', function(done) {
    jo.rotate(path.join(__dirname, '/samples/image_2.jpg'), 'options', function(error, buffer, orientation) {
      expect(error).to.equal(null)
      Buffer.isBuffer(buffer).should.be.ok
      expect(orientation).to.equal(2)
      done()
    })
  })

  it('Should return an error if the image has no orientation tag', function(done) {
    jo.rotate(path.join(__dirname, '/samples/image_no_orientation.jpg'), {}, function(error, buffer, orientation) {
      error.should.have.property('code').equal(jo.errors.no_orientation)
      Buffer.isBuffer(buffer).should.be.ok
      expect(orientation).to.equal(null)
      done()
    })
  })

  it('Should return an error if the image has an unknown orientation tag', function(done) {
    jo.rotate(path.join(__dirname, '/samples/image_unknown_orientation.jpg'), {}, function(error, buffer, orientation) {
      error.should.have.property('code').equal(jo.errors.unknown_orientation)
      Buffer.isBuffer(buffer).should.be.ok
      expect(orientation).to.equal(null)
      done()
    })
  })

  it('Should run on CLI (with glob support)', function(done) {
    const command = `
            cp test/samples/image_2.jpg test/samples/image_2.cli.jpg &&
            cp test/samples/image_3.jpg test/samples/image_3.cli.jpg &&
            cp test/samples/image_4.jpg test/samples/image_4.cli.jpg &&
            ./src/cli.js test/samples/image_2.cli.jpg "test/samples/image_{3,4}.cli.jpg" &&
            rm test/samples/image_2.cli.jpg &&
            rm test/samples/image_3.cli.jpg &&
            rm test/samples/image_4.cli.jpg
        `
    exec(command, function(error, stdout, stderr) {
      stdout.should.be.a('string').and.contain('Processed (Orientation was 2)')
      stdout.should.be.a('string').and.contain('Processed (Orientation was 3)')
      stdout.should.be.a('string').and.contain('Processed (Orientation was 4)')
      stderr.should.equal('')
      done()
    })
  })

  // @todo test jo.errors.read_exif (corrupted EXIF data ?)
  // @todo test jo.errors.rotate_file (corrupted JPEG ?)
})

/**
 * Tries to transform the given path/buffer, and checks data integrity (EXIF, dimensions)
 * @param path_or_buffer
 * @param label
 */
function itShouldTransform(path_or_buffer, label) {
  it('Should rotate image (' + label + ')', function(done) {
    this.timeout(20000)
    const orig_buffer = typeof path_or_buffer === 'string' ? fs.readFileSync(path_or_buffer) : path_or_buffer
    const orig_exif = piexif.load(orig_buffer.toString('binary'))
    const orig_jpeg = jpegjs.decode(orig_buffer)
    jo.rotate(path_or_buffer, {}, function(error, buffer, orientation, dimensions) {
      if (error) {
        throw error
      }
      const dest_exif = piexif.load(buffer.toString('binary'))
      if (orientation < 5 && (orig_jpeg.width !== dimensions.width || orig_jpeg.height !== dimensions.height)) {
        throw new Error('Dimensions do not match')
      }
      if (orientation >= 5 && (orig_jpeg.width !== dimensions.height || orig_jpeg.height !== dimensions.width)) {
        throw new Error('Dimensions do not match')
      }
      if (!compareEXIF(orig_exif, dest_exif)) {
        throw new Error('EXIF do not match')
      }
      if (typeof path_or_buffer === 'string') {
        const target_buffer = fs.readFileSync(path_or_buffer.replace('.jpg', '_dest.jpg'))
        const target_jpeg = jpegjs.decode(target_buffer)
        const diff_png = new PNG({width: target_jpeg.width, height: target_jpeg.height})
        const diff_pixels = pixelmatch(
          jpegjs.decode(buffer).data,
          target_jpeg.data,
          diff_png.data,
          target_jpeg.width,
          target_jpeg.height,
          {
            threshold: 0.25,
          }
        )
        const diff_path = path.join(tmp_path, path.parse(path_or_buffer).base.replace('.jpg', '.diff.png'))
        diff_png.pack().pipe(fs.createWriteStream(diff_path))
        fs.writeFileSync(path_or_buffer.replace('samples/', '.tmp/'), buffer)
        expect(diff_pixels).to.equal(0)
      }
      done()
    })
  })
}

/**
 * Compares EXIF arrays
 * The properties allowed to differ between the two versions are set to 0
 * @param orig
 * @param dest
 */
function compareEXIF(orig, dest) {
  orig['thumbnail'] = 0 // The thumbnail
  dest['thumbnail'] = 0
  orig['0th'][piexif.ImageIFD.Orientation] = 0 // Orientation
  dest['0th'][piexif.ImageIFD.Orientation] = 0
  orig['0th'][piexif.ImageIFD.ExifTag] = 0 // Pointer to the Exif IFD
  dest['0th'][piexif.ImageIFD.ExifTag] = 0
  orig['Exif'][piexif.ExifIFD.PixelXDimension] = 0 // Image width
  dest['Exif'][piexif.ExifIFD.PixelXDimension] = 0
  orig['Exif'][piexif.ExifIFD.PixelYDimension] = 0 // Image height
  dest['Exif'][piexif.ExifIFD.PixelYDimension] = 0
  orig['1st'][piexif.ImageIFD.JPEGInterchangeFormat] = 0 // Offset to the start byte of the thumbnail
  dest['1st'][piexif.ImageIFD.JPEGInterchangeFormat] = 0
  orig['1st'][piexif.ImageIFD.JPEGInterchangeFormatLength] = 0 // Number of bytes of the thumbnail
  dest['1st'][piexif.ImageIFD.JPEGInterchangeFormatLength] = 0

  const orig_json = JSON.stringify(orig)
  const dest_json = JSON.stringify(dest)

  return orig_json === dest_json
}
