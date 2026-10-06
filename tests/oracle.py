#!/usr/bin/env python3
"""Oracle for ExifLens: every EXIF field from REAL exifread, plus independent
python GPS-decimal and APEX conversions over the raw tag values."""
import exifread, json, os, struct

def ratio_to_float(v):
    return v.num / v.den if v.den else 0.0

def gps_decimal(vals, ref):
    # independent conversion: d + m/60 + s/3600, signed by ref
    d = ratio_to_float(vals[0]); m = ratio_to_float(vals[1]); s = ratio_to_float(vals[2])
    dec = d + m/60.0 + s/3600.0
    if ref in ('S','W'): dec = -dec
    return dec

WANT = {
 '0th': ['Make','Model','Orientation','XResolution','YResolution','ResolutionUnit','Software','DateTime'],
 'exif': ['ExposureTime','FNumber','ExposureProgram','ISOSpeedRatings','ExifVersion','DateTimeOriginal',
          'ShutterSpeedValue','ApertureValue','BrightnessValue','ExposureBiasValue','MaxApertureValue',
          'MeteringMode','Flash','FocalLength','ColorSpace','PixelXDimension','PixelYDimension',
          'LensMake','LensModel','BodySerialNumber'],
 'gps': ['GPSLatitudeRef','GPSLatitude','GPSLongitudeRef','GPSLongitude','GPSAltitudeRef','GPSAltitude','GPSDateStamp'],
}

def dump(path):
    tags = exifread.process_file(open(path,'rb'), details=False)
    out = {'file': os.path.basename(path), 'has_exif': bool(tags)}
    # byte order from raw APP1
    raw = open(path,'rb').read()
    i = raw.find(b'Exif\x00\x00')
    if i >= 0:
        bo = raw[i+6:i+8]
        out['byte_order'] = 'MM' if bo == b'MM' else 'II'
    for prefix, keys in (('Image', WANT['0th']), ('EXIF', WANT['exif']), ('GPS', WANT['gps'])):
        group = '0th' if prefix=='Image' else ('exif' if prefix=='EXIF' else 'gps')
        for k in keys:
            full = prefix + ' ' + k
            if full not in tags: continue
            v = tags[full]
            vals = v.values
            if isinstance(vals, bytes):
                out[k] = vals.decode('latin1').rstrip('\x00')
            elif isinstance(vals, str):
                out[k] = vals
            elif isinstance(vals, list):
                if vals and hasattr(vals[0], 'num'):
                    out[k] = [[x.num, x.den] for x in vals]
                else:
                    out[k] = vals[0] if len(vals)==1 else vals
            else:
                out[k] = vals
    # independent conversions from the raw oracle values
    if 'GPSLatitude' in out:
        class R: 
            def __init__(s, nd): s.num, s.den = nd
        lat = gps_decimal([R(x) for x in out['GPSLatitude']], out['GPSLatitudeRef'])
        lon = gps_decimal([R(x) for x in out['GPSLongitude']], out['GPSLongitudeRef'])
        out['gps_lat_dec'] = round(lat, 6)
        out['gps_lon_dec'] = round(lon, 6)
        alt = out.get('GPSAltitude')
        if alt:
            if isinstance(alt[0], list): alt = alt[0]
            sign = -1 if out.get('GPSAltitudeRef') == 1 else 1
            out['gps_alt_signed'] = sign * alt[0]/alt[1]
    if 'ShutterSpeedValue' in out:
        av = out['ShutterSpeedValue']
        if isinstance(av[0], list): av = av[0]
        out['apex_shutter_s'] = 2.0 ** (-(av[0]/av[1]))
    if 'ApertureValue' in out:
        av = out['ApertureValue']
        if isinstance(av[0], list): av = av[0]
        out['apex_fnumber'] = 2.0 ** ((av[0]/av[1])/2.0)
    return out

items = []
for f in ['canon_gps.jpg','apple_sw.jpg','minimal.jpg','bigendian.jpg','littleendian.jpg','noexif.jpg']:
    items.append(dump(os.path.join('tests/corpus', f)))
json.dump({'items': items}, open('tests/expected.json','w'), indent=1)
open('tests/expected.json','a').write('\n')
for it in items:
    print(it['file'], 'exif=', it['has_exif'], 'order=', it.get('byte_order'), 'fields=', len(it)-3)
