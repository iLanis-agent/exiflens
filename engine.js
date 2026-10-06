/* ExifLens engine - JPEG APP1 EXIF/TIFF parser.
   Walks JPEG segments to the Exif APP1, parses the TIFF header (II/MM),
   IFD0, ExifIFD (0x8769) and GPSIFD (0x8825). Decodes ASCII, SHORT, LONG,
   RATIONAL, SRATIONAL, BYTE, UNDEFINED. GPS decimal + APEX conversions.
   No deps. Browser global ExifLens, or module.exports in node. */
(function(root){
'use strict';
var TSIZE=[0,1,1,2,4,8,1,1,2,4,8,4,8];
var TAGS_IFD0={0x010F:'Make',0x0110:'Model',0x0112:'Orientation',0x011A:'XResolution',
  0x011B:'YResolution',0x0128:'ResolutionUnit',0x0131:'Software',0x0132:'DateTime'};
var TAGS_EXIF={0x829A:'ExposureTime',0x829D:'FNumber',0x8822:'ExposureProgram',
  0x8827:'ISOSpeedRatings',0x9000:'ExifVersion',0x9003:'DateTimeOriginal',
  0x9201:'ShutterSpeedValue',0x9202:'ApertureValue',0x9203:'BrightnessValue',
  0x9204:'ExposureBiasValue',0x9205:'MaxApertureValue',0x9207:'MeteringMode',
  0x9209:'Flash',0x920A:'FocalLength',0xA001:'ColorSpace',0xA002:'PixelXDimension',
  0xA003:'PixelYDimension',0xA431:'BodySerialNumber',0xA433:'LensMake',0xA434:'LensModel'};
var TAGS_GPS={0:'GPSVersionID',1:'GPSLatitudeRef',2:'GPSLatitude',3:'GPSLongitudeRef',
  4:'GPSLongitude',5:'GPSAltitudeRef',6:'GPSAltitude',7:'GPSTimeStamp',29:'GPSDateStamp'};
function gcd(a,b2){a=Math.abs(a);b2=Math.abs(b2);while(b2){var t=a%b2;a=b2;b2=t;}return a||1;}
function reduce(n,d){if(d===0)return [n,d];var g=gcd(n,d);return [n/g,d/g];}
function ascii(b,o,n){
  var s='';
  for(var i=0;i<n;i++){var c=b[o+i];if(c===0)break;s+=String.fromCharCode(c);}
  return s;
}
function parse(bytes){
  var out={has_exif:false,errors:[],warnings:[]};
  if(bytes.length<4||bytes[0]!==0xFF||bytes[1]!==0xD8){
    out.errors.push('not a JPEG (missing SOI marker)');return out;
  }
  var pos=2,tiff=-1;
  while(pos+4<=bytes.length){
    if(bytes[pos]!==0xFF)break;
    var marker=bytes[pos+1];
    if(marker===0xD9||marker===0xDA)break;
    var len=(bytes[pos+2]<<8)|bytes[pos+3];
    if(marker===0xE1&&pos+10<=bytes.length&&
       bytes[pos+4]===0x45&&bytes[pos+5]===0x78&&bytes[pos+6]===0x69&&
       bytes[pos+7]===0x66&&bytes[pos+8]===0&&bytes[pos+9]===0){
      tiff=pos+10;break;
    }
    pos+=2+len;
  }
  if(tiff<0)return out;
  out.has_exif=true;
  var b=bytes;
  var ii=b[tiff]===0x49&&b[tiff+1]===0x49;
  var mm=b[tiff]===0x4D&&b[tiff+1]===0x4D;
  if(!ii&&!mm){out.errors.push('bad TIFF byte order');return out;}
  out.byte_order=ii?'II':'MM';
  function u16(o){return ii?(b[o]|(b[o+1]<<8)):((b[o]<<8)|b[o+1]);}
  function u32(o){return ii?((b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0):(((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0);}
  function s32(o){var v=u32(o);return v>0x7FFFFFFF?v-0x100000000:v;}
  if(u16(tiff+2)!==42){out.errors.push('bad TIFF magic');return out;}
  var fields={};
  function readValue(type,cnt,vo){
    var size=TSIZE[type]*cnt;
    var base=size<=4?vo:tiff+u32(vo);
    if(base+size>b.length)return {truncated:true};
    if(type===2)return {str:ascii(b,base,cnt)};
    var vals=[],i;
    for(i=0;i<cnt;i++){
      var p=base+i*TSIZE[type];
      switch(type){
        case 1:case 6:case 7:vals.push(b[p]);break;
        case 3:vals.push(u16(p));break;
        case 8:vals.push((b[p]|(b[p+1]<<8))<<16>>16);break;
        case 4:vals.push(u32(p));break;
        case 9:vals.push(s32(p));break;
        case 5:vals.push(reduce(u32(p),u32(p+4)));break;
        case 10:vals.push(reduce(s32(p),s32(p+4)));break;
        case 11:case 12:return {unsupported:type};
        default:return {unknown:type};
      }
    }
    if(type===2)return {str:ascii(b,base,cnt)};
    return {vals:vals};
  }
  function walkIFD(off,tagmap,depth){
    if(off<=0||tiff+off+2>b.length||depth>4)return;
    var count=u16(tiff+off);
    if(count>500){out.warnings.push('implausible IFD count at '+off);return;}
    for(var i=0;i<count;i++){
      var e=tiff+off+2+i*12;
      if(e+12>b.length){out.warnings.push('truncated IFD entry');return;}
      var tag=u16(e),type=u16(e+2),cnt=u32(e+4);
      if(tag===0x8769&&tagmap===TAGS_IFD0){walkIFD(u32(e+8),TAGS_EXIF,depth+1);continue;}
      if(tag===0x8825&&tagmap===TAGS_IFD0){walkIFD(u32(e+8),TAGS_GPS,depth+1);continue;}
      var name=tagmap[tag];
      if(!name)continue;
      if(cnt>10000)continue;
      var r=readValue(type,cnt,e+8);
      if(r.truncated){out.warnings.push('truncated value for '+name);continue;}
      if(r.unsupported||r.unknown)continue;
      if(r.str!==undefined){fields[name]=r.str;continue;}
      var vals=r.vals;
      if(type===5||type===10){fields[name]=vals;}
      else fields[name]=vals.length===1?vals[0]:vals;
    }
  }
  walkIFD(u32(tiff+4),TAGS_IFD0,0);
  /* GPS decimal conversion */
  if(fields.GPSLatitude&&fields.GPSLatitudeRef){
    var la=fields.GPSLatitude;
    var lat=la[0][0]/la[0][1]+(la[1][0]/la[1][1])/60+(la[2][0]/la[2][1])/3600;
    if(fields.GPSLatitudeRef==='S')lat=-lat;
    fields.GPSLatitudeDec=Math.round(lat*1e6)/1e6;
  }
  if(fields.GPSLongitude&&fields.GPSLongitudeRef){
    var lo=fields.GPSLongitude;
    var lon=lo[0][0]/lo[0][1]+(lo[1][0]/lo[1][1])/60+(lo[2][0]/lo[2][1])/3600;
    if(fields.GPSLongitudeRef==='W')lon=-lon;
    fields.GPSLongitudeDec=Math.round(lon*1e6)/1e6;
  }
  if(fields.GPSAltitude&&Array.isArray(fields.GPSAltitude[0])){
    var al=fields.GPSAltitude[0];
    var alt=al[0]/al[1];
    if(fields.GPSAltitudeRef===1)alt=-alt;
    fields.GPSAltitudeSigned=alt;
  }
  if(fields.ShutterSpeedValue){
    var sv=fields.ShutterSpeedValue[0];
    fields.ApexShutterSeconds=Math.pow(2,-(sv[0]/sv[1]));
  }
  if(fields.ApertureValue){
    var av=fields.ApertureValue[0];
    fields.ApexFNumber=Math.pow(2,(av[0]/av[1])/2);
  }
  out.fields=fields;
  return out;
}
var api={parse:parse};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.ExifLens=api;
})(typeof self!=='undefined'?self:this);
